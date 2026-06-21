"""Nossa Fintech bot service — REST multi-tenant, batch-aware.

Mesma orquestração do vctex_bot_service, mas spawna NossaFintechApiWorker (REST,
sem browser). Fluxo CLT por CPF: check_authorization → enrollment → margin → simulate.
"""
import asyncio
import json
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable

from ..redis_client import get_redis
from ..db_scoped import scoped
from ..banks.nossafintech.api_worker import NossaFintechApiWorker
from ..banks.nossafintech.bot_pool import NossaFintechBotPool

logger = logging.getLogger(__name__)

REFILL_INTERVAL = 5
PENDING_BATCH = 50
MAX_QUEUE_SIZE = 200
EVENT_CHANNEL = "nossafintech:events"
WORKER_STAGGER_SECONDS = 1.0
PENDING_STATUSES = ["pendente", "erro"]


@dataclass
class _Runtime:
    running: bool = True
    queue: asyncio.Queue = field(default_factory=asyncio.Queue)
    inflight: set[str] = field(default_factory=set)
    worker_tasks: list[asyncio.Task] = field(default_factory=list)
    run_task: asyncio.Task | None = None
    stop_event: asyncio.Event = field(default_factory=asyncio.Event)


_runtimes: dict[str, _Runtime] = {}


async def _broadcast(redis, event: dict):
    await redis.publish(EVENT_CHANNEL, json.dumps(event))


async def _fetch_pending(db: Any, user_id: str, limit: int, batch_id: str | None = None) -> list[dict]:
    def _q():
        q = scoped(db, "nossafintech_leads", user_id).select("*").in_("status", PENDING_STATUSES)
        if batch_id is not None:
            q = q.eq("batch_id", batch_id)
        return q.limit(limit).execute().data or []

    rows = await asyncio.to_thread(_q)

    if not rows and batch_id is not None:
        logger.warning("nossafintech batch %s vazia, buscando sem filtro de batch", batch_id)
        def _q_all():
            return scoped(db, "nossafintech_leads", user_id).select("*").in_(
                "status", PENDING_STATUSES
            ).limit(limit).execute().data or []
        rows = await asyncio.to_thread(_q_all)

    return rows


async def start_bot(
    pool: NossaFintechBotPool,
    user_id: str,
    num_workers: int,
    creds: Any,
    db: Any,
    on_event: Callable,
    batch_id: str | None = None,
):
    if user_id in _runtimes:
        return {"status": "already_running"}

    from ..redis_client import assert_redis_responsive
    try:
        await assert_redis_responsive()
    except RuntimeError as e:
        from fastapi import HTTPException
        raise HTTPException(status_code=503, detail=str(e))

    handle = await pool.start(user_id=user_id, num_workers=num_workers, creds=creds, db=db)
    rt = _Runtime()
    _runtimes[user_id] = rt
    redis = await get_redis()
    await _broadcast(redis, {
        "type": "bot_status", "status": "running", "user_id": user_id,
        "bank": "nossafintech", "full_workers": handle.num_workers, "batch_id": batch_id,
    })

    if batch_id is not None:
        try:
            def _mark_running():
                scoped(db, "nossafintech_batches", user_id).update({
                    "status": "processando",
                    "started_at": datetime.now(timezone.utc).isoformat(),
                }).eq("id", batch_id).execute()
            await asyncio.to_thread(_mark_running)
        except Exception as e:
            logger.warning(f"nossafintech mark batch processando[{batch_id}] failed: {e}")

    processed = {"count": 0, "eleg": 0, "ineleg": 0}

    async def on_event_async(event):
        if event.get("type") == "lead_result":
            processed["count"] += 1
            fase = event.get("fase", "")
            if fase == "elegivel":
                processed["eleg"] += 1
            elif fase == "inelegivel":
                processed["ineleg"] += 1
            cpf_done = event.get("cpf")
            if cpf_done:
                rt.inflight.discard(cpf_done)
        await _broadcast(redis, {**event, "bank": "nossafintech"})
        on_event(event)
        pool.emit(user_id, event)

    def on_event_wrapper(event):
        t = asyncio.create_task(on_event_async(event))
        handle.tasks.append(t)
        t.add_done_callback(handle.tasks.remove)

    async def _refill_queue():
        idle_ticks = 0
        while rt.running:
            try:
                if rt.queue.qsize() >= MAX_QUEUE_SIZE:
                    await asyncio.sleep(REFILL_INTERVAL)
                    continue
                pendentes = await _fetch_pending(db, user_id, PENDING_BATCH, batch_id=batch_id)
                added = 0
                for lead in pendentes:
                    cpf = lead.get("cpf")
                    if cpf in rt.inflight:
                        continue
                    rt.inflight.add(cpf)
                    await rt.queue.put(lead)
                    added += 1

                logger.info(
                    "nossafintech refill[%s] fetched=%d added=%d queue=%d inflight=%d batch=%s",
                    user_id, len(pendentes), added, rt.queue.qsize(), len(rt.inflight), batch_id,
                )

                if added == 0 and rt.queue.empty() and not rt.inflight:
                    idle_ticks += 1
                    if idle_ticks >= 3:
                        return
                else:
                    idle_ticks = 0
                await asyncio.sleep(REFILL_INTERVAL)
            except asyncio.CancelledError:
                raise
            except Exception as e:
                logger.exception(f"nossafintech refill[{user_id}] error: {e}")
                await asyncio.sleep(REFILL_INTERVAL)

    async def _run():
        try:
            for i in range(handle.num_workers):
                w = NossaFintechApiWorker(
                    worker_id=i, user_id=user_id, creds=creds, db=db,
                    on_event=on_event_wrapper,
                    startup_delay=i * WORKER_STAGGER_SECONDS,
                    batch_id=batch_id,
                )

                async def _wrap(worker=w):
                    try:
                        await worker.run(rt.queue, stop_event=rt.stop_event)
                    finally:
                        logger.info("nossafintech worker_%d encerrou", worker.worker_id)
                        active = [t for t in rt.worker_tasks if not t.done()]
                        if len(active) <= 1:
                            rt.inflight.clear()

                t = asyncio.create_task(_wrap())
                rt.worker_tasks.append(t)
            handle.tasks.extend(rt.worker_tasks)

            refill = asyncio.create_task(_refill_queue())
            handle.tasks.append(refill)
            await refill
            rt.stop_event.set()
            for t in rt.worker_tasks:
                try:
                    await t
                except Exception:
                    pass
        except asyncio.CancelledError:
            logger.info(f"nossafintech bot run[{user_id}] cancelled")
        finally:
            rt.running = False
            for t in rt.worker_tasks:
                t.cancel()
            await asyncio.gather(*rt.worker_tasks, return_exceptions=True)
            rt.worker_tasks = []

            def _finalize():
                eleg = processed["eleg"]
                ineleg = processed["ineleg"]
                now_iso = datetime.now(timezone.utc).isoformat()
                scoped(db, "nossafintech_bot_runs", user_id).update({
                    "status": "completed",
                    "finished_at": now_iso,
                    "total_processed": processed["count"],
                    "total_elegiveis": eleg,
                    "total_inelegiveis": ineleg,
                }).eq("id", handle.run_id).execute()
                if batch_id is not None:
                    rows = (
                        scoped(db, "nossafintech_leads", user_id)
                        .select("status,valor_liberado")
                        .eq("batch_id", batch_id)
                        .execute().data or []
                    )
                    liberado = sum(float(r.get("valor_liberado") or 0) for r in rows if r["status"] == "elegivel")
                    scoped(db, "nossafintech_batches", user_id).update({
                        "status": "concluida",
                        "finished_at": now_iso,
                        "total_processed": processed["count"],
                        "total_elegiveis": eleg,
                        "total_inelegiveis": ineleg,
                        "total_liberado": round(liberado, 2),
                    }).eq("id", batch_id).execute()
            try:
                await asyncio.to_thread(_finalize)
            except Exception as e:
                logger.warning(f"nossafintech finalize[{user_id}] failed: {e}")
            await _broadcast(redis, {"type": "bot_status", "status": "idle",
                                     "user_id": user_id, "bank": "nossafintech"})
            _runtimes.pop(user_id, None)
            try:
                await pool.stop(user_id)
            except Exception:
                pass

    rt.run_task = asyncio.create_task(_run())
    return {
        "status": "started", "bank": "nossafintech",
        "run_id": handle.run_id, "full_workers": handle.num_workers,
    }


async def stop_bot(pool: NossaFintechBotPool, user_id: str):
    rt = _runtimes.get(user_id)
    if not rt:
        await pool.stop(user_id)
        return {"status": "not_running", "bank": "nossafintech"}
    rt.running = False
    if rt.run_task:
        rt.run_task.cancel()
        try:
            await asyncio.wait_for(rt.run_task, timeout=10)
        except (asyncio.CancelledError, asyncio.TimeoutError):
            pass
    await pool.stop(user_id)
    redis = await get_redis()
    await _broadcast(redis, {"type": "bot_status", "status": "idle",
                             "user_id": user_id, "bank": "nossafintech"})
    return {"status": "stopped", "bank": "nossafintech"}


async def get_bot_status(pool: NossaFintechBotPool, user_id: str):
    handle = pool.status(user_id)
    if handle is None:
        return {"status": "idle", "bank": "nossafintech"}
    return {
        "status": "running",
        "bank": "nossafintech",
        "run_id": handle.run_id,
        "num_workers": handle.num_workers,
        "started_at": handle.started_at.isoformat(),
    }
