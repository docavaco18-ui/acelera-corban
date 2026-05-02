"""VCTex bot service — multi-tenant, batch-aware, paralelo ao bot_service.py do V8."""
import asyncio
import json
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable

from ..redis_client import get_redis
from ..db_scoped import scoped
from ..banks.vctex.worker import VCTexLeadWorker
from ..banks.vctex.bot_pool import VCTexBotPool, VCTexRunHandle

logger = logging.getLogger(__name__)

REFILL_INTERVAL = 5
PENDING_BATCH = 50
EVENT_CHANNEL = "vctex:events"
WORKER_STAGGER_SECONDS = 1.5  # Era 5s — antiga proteção contra impossible-travel


@dataclass
class _Runtime:
    running: bool = True
    queue: asyncio.Queue = field(default_factory=asyncio.Queue)
    inflight: set[str] = field(default_factory=set)
    worker_tasks: list[asyncio.Task] = field(default_factory=list)
    run_task: asyncio.Task | None = None


_runtimes: dict[str, _Runtime] = {}


async def _broadcast(redis, event: dict):
    await redis.publish(EVENT_CHANNEL, json.dumps(event))


async def _fetch_pending(db: Any, user_id: str, limit: int, batch_id: str | None = None) -> list[dict]:
    def _q():
        q = scoped(db, "vctex_leads", user_id).select("*").in_(
            "status", ["pendente", "fase0", "fase1", "fase2", "erro"]
        )
        if batch_id is not None:
            q = q.eq("batch_id", batch_id)
        return q.limit(limit).execute().data or []
    return await asyncio.to_thread(_q)


async def start_bot(
    pool: VCTexBotPool,
    user_id: str,
    num_workers: int,
    creds: Any,
    db: Any,
    on_event: Callable,
    batch_id: str | None = None,
):
    """Inicia bot VCTex para um user, opcionalmente escopado pra batch."""
    if user_id in _runtimes:
        return {"status": "already_running"}

    handle = await pool.start(user_id=user_id, num_workers=num_workers, creds=creds, db=db)
    rt = _Runtime()
    _runtimes[user_id] = rt
    redis = await get_redis()
    await _broadcast(redis, {
        "type": "bot_status", "status": "running", "user_id": user_id,
        "bank": "vctex", "full_workers": handle.num_workers, "batch_id": batch_id,
    })

    if batch_id is not None:
        try:
            def _mark_running():
                scoped(db, "vctex_batches", user_id).update({
                    "status": "processando",
                    "started_at": datetime.now(timezone.utc).isoformat(),
                }).eq("id", batch_id).execute()
            await asyncio.to_thread(_mark_running)
        except Exception as e:
            logger.warning(f"vctex mark batch processando[{batch_id}] failed: {e}")

    processed = {"count": 0}

    async def on_event_async(event):
        if event.get("type") == "lead_result":
            processed["count"] += 1
        await _broadcast(redis, {**event, "bank": "vctex"})
        on_event(event)
        pool.emit(user_id, event)

    def on_event_wrapper(event):
        asyncio.create_task(on_event_async(event))

    async def _refill_queue():
        """Loop que enche a fila com leads pendentes da batch."""
        idle_ticks = 0
        while rt.running:
            try:
                pendentes = await _fetch_pending(db, user_id, PENDING_BATCH, batch_id=batch_id)
                added = 0
                for lead in pendentes:
                    cpf = lead.get("cpf")
                    if cpf in rt.inflight:
                        continue
                    rt.inflight.add(cpf)
                    await rt.queue.put(lead)
                    added += 1

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
                logger.exception(f"vctex refill[{user_id}] error: {e}")
                await asyncio.sleep(REFILL_INTERVAL)

    async def _run():
        try:
            for i in range(handle.num_workers):
                w = VCTexLeadWorker(
                    worker_id=i, user_id=user_id, creds=creds, db=db,
                    on_event=on_event_wrapper,
                    startup_delay=i * WORKER_STAGGER_SECONDS,
                    batch_id=batch_id,
                )

                async def _wrap(worker=w):
                    try:
                        await worker.run(rt.queue)
                    finally:
                        # Quando worker termina (queue empty), libera inflight
                        pass

                t = asyncio.create_task(_wrap())
                rt.worker_tasks.append(t)
            handle.tasks.extend(rt.worker_tasks)

            refill = asyncio.create_task(_refill_queue())
            handle.tasks.append(refill)
            await refill
            # Espera workers escoarem
            for t in rt.worker_tasks:
                try:
                    await t
                except Exception:
                    pass
        except asyncio.CancelledError:
            logger.info(f"vctex bot run[{user_id}] cancelled")
        finally:
            rt.running = False
            for t in rt.worker_tasks:
                t.cancel()
            await asyncio.gather(*rt.worker_tasks, return_exceptions=True)
            rt.worker_tasks = []

            def _finalize():
                q = scoped(db, "vctex_leads", user_id).select("status,valor_liberado")
                if batch_id is not None:
                    q = q.eq("batch_id", batch_id)
                stats = q.execute().data or []
                eleg = sum(1 for r in stats if r["status"] == "elegivel")
                ineleg = sum(1 for r in stats if r["status"] == "inelegivel")
                liberado = sum(float(r.get("valor_liberado") or 0) for r in stats if r["status"] == "elegivel")
                now_iso = datetime.now(timezone.utc).isoformat()
                scoped(db, "vctex_bot_runs", user_id).update({
                    "status": "completed",
                    "finished_at": now_iso,
                    "total_processed": processed["count"],
                    "total_elegiveis": eleg,
                    "total_inelegiveis": ineleg,
                }).eq("id", handle.run_id).execute()
                if batch_id is not None:
                    scoped(db, "vctex_batches", user_id).update({
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
                logger.warning(f"vctex finalize[{user_id}] failed: {e}")
            await _broadcast(redis, {"type": "bot_status", "status": "idle",
                                     "user_id": user_id, "bank": "vctex"})
            _runtimes.pop(user_id, None)
            try:
                await pool.stop(user_id)
            except Exception:
                pass

    rt.run_task = asyncio.create_task(_run())
    return {
        "status": "started", "bank": "vctex",
        "run_id": handle.run_id, "full_workers": handle.num_workers,
    }


async def stop_bot(pool: VCTexBotPool, user_id: str):
    rt = _runtimes.get(user_id)
    if not rt:
        await pool.stop(user_id)
        return {"status": "not_running", "bank": "vctex"}
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
                             "user_id": user_id, "bank": "vctex"})
    return {"status": "stopped", "bank": "vctex"}


async def get_bot_status(pool: VCTexBotPool, user_id: str):
    handle = pool.status(user_id)
    if handle is None:
        return {"status": "idle", "bank": "vctex"}
    return {
        "status": "running",
        "bank": "vctex",
        "run_id": handle.run_id,
        "num_workers": handle.num_workers,
        "started_at": handle.started_at.isoformat(),
    }
