import asyncio
import json
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable
from ..redis_client import get_redis
from ..db_scoped import scoped
from ..banks.v8.worker import LeadWorker
from ..banks.v8.bot_pool import V8BotPool, RunHandle

logger = logging.getLogger(__name__)

REFILL_INTERVAL = 5
IDLE_INTERVAL = 30
CEREBRO_INTERVAL = 3
PENDING_BATCH = 200
RETRY_BATCH = 200


@dataclass
class _Runtime:
    """Estado interno por user durante uma run de bot."""
    running: bool = True
    pending_queue: asyncio.Queue = field(default_factory=asyncio.Queue)
    retry_queue: asyncio.Queue = field(default_factory=asyncio.Queue)
    inflight: set[str] = field(default_factory=set)
    full_tasks: list[asyncio.Task] = field(default_factory=list)
    retry_tasks: list[asyncio.Task] = field(default_factory=list)
    run_task: asyncio.Task | None = None


# Per-user runtime, paralelo ao V8BotPool (que segura o RunHandle público).
_runtimes: dict[str, _Runtime] = {}


async def _broadcast(redis, event: dict):
    await redis.publish("bot:events", json.dumps(event))


async def _fetch_pending(db: Any, user_id: str, limit: int, batch_id: str | None = None) -> list[dict]:
    def _q():
        q = scoped(db, "v8_leads", user_id).select("*").eq("status", "pendente")
        if batch_id is not None:
            q = q.eq("batch_id", batch_id)
        return q.limit(limit).execute().data or []
    return await asyncio.to_thread(_q)


async def _fetch_retries(db: Any, user_id: str, limit: int, batch_id: str | None = None) -> list[dict]:
    def _q():
        now_iso = datetime.now(timezone.utc).isoformat()
        q = (
            scoped(db, "v8_leads", user_id).select("*")
            .eq("status", "aguardando_resultado")
            .lte("proxima_tentativa", now_iso)
        )
        if batch_id is not None:
            q = q.eq("batch_id", batch_id)
        return q.limit(limit).execute().data or []
    return await asyncio.to_thread(_q)


async def _count_scheduled(db: Any, user_id: str, batch_id: str | None = None) -> int:
    def _q():
        now_iso = datetime.now(timezone.utc).isoformat()
        q = (
            scoped(db, "v8_leads", user_id).select("id")
            .eq("status", "aguardando_resultado")
            .gt("proxima_tentativa", now_iso)
        )
        if batch_id is not None:
            q = q.eq("batch_id", batch_id)
        return len(q.execute().data or [])
    return await asyncio.to_thread(_q)


async def start_bot(
    pool: V8BotPool,
    user_id: str,
    num_workers: int,
    creds: Any,
    db: Any,
    on_event: Callable,
    num_retry_workers: int = 3,
    batch_id: str | None = None,
):
    """Inicia bot pra um user. Levanta 409/503 via pool se já rodando ou capacidade cheia.

    Quando batch_id é passado, todas as queries (pending/retry/finalize)
    são filtradas pra processar só os leads da batch — isolamento por upload.
    """
    if user_id in _runtimes:
        return {"status": "already_running"}

    handle = await pool.start(user_id=user_id, num_workers=num_workers, creds=creds, db=db)
    rt = _Runtime()
    _runtimes[user_id] = rt
    redis = await get_redis()
    await _broadcast(redis, {
        "type": "bot_status", "status": "running", "user_id": user_id,
        "full_workers": handle.num_workers, "retry_workers": num_retry_workers,
        "batch_id": batch_id,
    })

    # Marca batch como "processando"
    if batch_id is not None:
        try:
            def _mark_running():
                scoped(db, "v8_batches", user_id).update({
                    "status": "processando",
                    "started_at": datetime.now(timezone.utc).isoformat(),
                }).eq("id", batch_id).execute()
            await asyncio.to_thread(_mark_running)
        except Exception as e:
            logger.warning(f"mark batch processando[{batch_id}] failed: {e}")

    processed = {"count": 0, "eleg": 0, "ineleg": 0, "last_persisted": -1}

    async def on_event_async(event):
        if event.get("type") == "lead_result":
            processed["count"] += 1
            s = event.get("status", "")
            if s == "elegivel":
                processed["eleg"] += 1
            elif s == "inelegivel":
                processed["ineleg"] += 1
        await _broadcast(redis, event)
        on_event(event)
        pool.emit(user_id, event)

    async def _persist_live_counts():
        """Atualiza v8_bot_runs (e v8_batches se houver) com contadores em tempo real.

        Roda dentro do cerebro_loop, que tickeia 3-5s. Faz no-op se nada mudou.
        Best-effort: warning em falha, não interrompe a run.
        """
        if processed["count"] == processed["last_persisted"]:
            return
        snapshot = dict(processed)

        def _flush():
            scoped(db, "v8_bot_runs", user_id).update({
                "total_processed": snapshot["count"],
                "total_elegiveis": snapshot["eleg"],
                "total_inelegiveis": snapshot["ineleg"],
            }).eq("id", handle.run_id).execute()
            if batch_id is not None:
                scoped(db, "v8_batches", user_id).update({
                    "total_processed": snapshot["count"],
                    "total_elegiveis": snapshot["eleg"],
                    "total_inelegiveis": snapshot["ineleg"],
                }).eq("id", batch_id).execute()

        try:
            await asyncio.to_thread(_flush)
            processed["last_persisted"] = snapshot["count"]
        except Exception as e:
            logger.warning(f"persist live counts[{user_id}] falhou: {e}")

    def on_event_wrapper(event):
        asyncio.create_task(on_event_async(event))

    async def _consume(worker_id: int, queue: asyncio.Queue, role: str, role_index: int):
        worker = LeadWorker(
            worker_id=worker_id, user_id=user_id, creds=creds, db=db,
            on_event=on_event_wrapper, role=role, role_index=role_index,
        )
        while rt.running:
            try:
                lead = await asyncio.wait_for(queue.get(), timeout=2.0)
            except asyncio.TimeoutError:
                continue
            cpf = lead.get("cpf")
            try:
                await worker.process(lead)
            except asyncio.CancelledError:
                raise
            except Exception as e:
                logger.exception(f"Worker[{role}][{user_id}] {worker_id} crash CPF {cpf}: {e}")
            finally:
                rt.inflight.discard(cpf)
                queue.task_done()

    async def cerebro_loop():
        idle_ticks = 0
        while rt.running:
            try:
                retries = await _fetch_retries(db, user_id, RETRY_BATCH, batch_id=batch_id)
                pendentes = await _fetch_pending(db, user_id, PENDING_BATCH, batch_id=batch_id)

                added_retry = 0
                for lead in retries:
                    cpf = lead.get("cpf")
                    if cpf in rt.inflight:
                        continue
                    rt.inflight.add(cpf)
                    await rt.retry_queue.put(lead)
                    added_retry += 1

                added_pending = 0
                for lead in pendentes:
                    cpf = lead.get("cpf")
                    if cpf in rt.inflight:
                        continue
                    rt.inflight.add(cpf)
                    await rt.pending_queue.put(lead)
                    added_pending += 1

                # Persiste contadores ao vivo na run + batch (best-effort)
                await _persist_live_counts()

                scheduled = await _count_scheduled(db, user_id, batch_id=batch_id)
                await _broadcast(redis, {
                    "type": "cerebro_status",
                    "user_id": user_id,
                    "worker_name": "SUPERVISOR",
                    "worker_role": "supervisor",
                    "ts": datetime.now(timezone.utc).isoformat(),
                    "pending_queue": rt.pending_queue.qsize(),
                    "retry_queue": rt.retry_queue.qsize(),
                    "inflight": len(rt.inflight),
                    "scheduled_retries": scheduled,
                    "added_pending": added_pending,
                    "added_retry": added_retry,
                    "full_pool": handle.num_workers,
                    "retry_pool": num_retry_workers,
                })

                if (
                    added_pending == 0 and added_retry == 0
                    and rt.pending_queue.empty() and rt.retry_queue.empty()
                    and not rt.inflight and scheduled == 0
                ):
                    idle_ticks += 1
                    if idle_ticks >= 2:
                        return
                else:
                    idle_ticks = 0

                if added_pending == 0 and added_retry == 0 and scheduled > 0:
                    await asyncio.sleep(IDLE_INTERVAL)
                else:
                    await asyncio.sleep(CEREBRO_INTERVAL if added_retry else REFILL_INTERVAL)
            except asyncio.CancelledError:
                raise
            except Exception as e:
                logger.exception(f"cerebro_loop[{user_id}] error: {e}")
                await asyncio.sleep(REFILL_INTERVAL)

    async def _run():
        try:
            rt.full_tasks = [
                asyncio.create_task(_consume(i, rt.pending_queue, "full", i))
                for i in range(handle.num_workers)
            ]
            rt.retry_tasks = [
                asyncio.create_task(_consume(1000 + i, rt.retry_queue, "retry", i))
                for i in range(num_retry_workers)
            ]
            handle.tasks.extend(rt.full_tasks + rt.retry_tasks)
            cerebro = asyncio.create_task(cerebro_loop())
            handle.tasks.append(cerebro)
            await cerebro
            await rt.pending_queue.join()
            await rt.retry_queue.join()
        except asyncio.CancelledError:
            logger.info(f"bot run[{user_id}] cancelled")
        finally:
            rt.running = False
            for t in rt.full_tasks + rt.retry_tasks:
                t.cancel()
            await asyncio.gather(*rt.full_tasks, *rt.retry_tasks, return_exceptions=True)
            rt.full_tasks = []
            rt.retry_tasks = []

            def _finalize():
                eleg = processed["eleg"]
                ineleg = processed["ineleg"]
                now_iso = datetime.now(timezone.utc).isoformat()
                scoped(db, "v8_bot_runs", user_id).update({
                    "status": "completed",
                    "finished_at": now_iso,
                    "total_processed": processed["count"],
                    "total_elegiveis": eleg,
                    "total_inelegiveis": ineleg,
                }).eq("id", handle.run_id).execute()
                # Atualiza totais da batch: re-escaneia só a batch pra pegar valor/margem
                if batch_id is not None:
                    rows = (
                        scoped(db, "v8_leads", user_id)
                        .select("status,valor_liberado,margem_disponivel")
                        .eq("batch_id", batch_id)
                        .execute().data or []
                    )
                    liberado = sum(float(r.get("valor_liberado") or 0) for r in rows if r["status"] == "elegivel")
                    margem = sum(float(r.get("margem_disponivel") or 0) for r in rows if r["status"] == "elegivel")
                    scoped(db, "v8_batches", user_id).update({
                        "status": "concluida",
                        "finished_at": now_iso,
                        "total_processed": processed["count"],
                        "total_elegiveis": eleg,
                        "total_inelegiveis": ineleg,
                        "total_liberado": round(liberado, 2),
                        "total_margem": round(margem, 2),
                    }).eq("id", batch_id).execute()
            try:
                await asyncio.to_thread(_finalize)
            except Exception as e:
                logger.warning(f"finalize bot_run[{user_id}] failed: {e}")
            await _broadcast(redis, {"type": "bot_status", "status": "idle", "user_id": user_id})
            _runtimes.pop(user_id, None)
            # Best-effort: pool.stop garante que o RunHandle saia do pool.
            try:
                await pool.stop(user_id)
            except Exception:
                pass

    rt.run_task = asyncio.create_task(_run())
    return {
        "status": "started",
        "run_id": handle.run_id,
        "full_workers": handle.num_workers,
        "retry_workers": num_retry_workers,
    }


async def stop_bot(pool: V8BotPool, user_id: str):
    rt = _runtimes.get(user_id)
    if not rt:
        await pool.stop(user_id)
        return {"status": "not_running"}
    rt.running = False
    if rt.run_task:
        rt.run_task.cancel()
        try:
            await asyncio.wait_for(rt.run_task, timeout=10)
        except (asyncio.CancelledError, asyncio.TimeoutError):
            pass
    await pool.stop(user_id)
    redis = await get_redis()
    await _broadcast(redis, {"type": "bot_status", "status": "idle", "user_id": user_id})
    return {"status": "stopped"}


async def get_bot_status(pool: V8BotPool, user_id: str):
    handle = pool.status(user_id)
    if handle is None:
        return {"status": "idle"}
    return {
        "status": "running",
        "run_id": handle.run_id,
        "num_workers": handle.num_workers,
        "started_at": handle.started_at.isoformat(),
    }
