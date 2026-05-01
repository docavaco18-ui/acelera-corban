import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Callable
from ..database import db
from ..redis_client import get_redis
from .worker import LeadWorker

logger = logging.getLogger(__name__)

_running = False
_run_task: asyncio.Task | None = None
_full_tasks: list[asyncio.Task] = []
_retry_tasks: list[asyncio.Task] = []
_pending_queue: asyncio.Queue | None = None
_retry_queue: asyncio.Queue | None = None
_inflight: set[str] = set()

REFILL_INTERVAL = 5
IDLE_INTERVAL = 30
CEREBRO_INTERVAL = 3
PENDING_BATCH = 200
RETRY_BATCH = 200


async def _broadcast(redis, event: dict):
    await redis.publish("bot:events", json.dumps(event))


async def _fetch_pending(limit: int, owner_id: str | None) -> list[dict]:
    def _q():
        q = db().table("v8_leads").select("*").eq("status", "pendente")
        if owner_id:
            q = q.eq("owner_id", owner_id)
        return q.limit(limit).execute().data or []
    return await asyncio.to_thread(_q)


async def _fetch_retries(limit: int, owner_id: str | None) -> list[dict]:
    def _q():
        now_iso = datetime.now(timezone.utc).isoformat()
        q = (
            db().table("v8_leads").select("*")
            .eq("status", "aguardando_resultado")
            .lte("proxima_tentativa", now_iso)
        )
        if owner_id:
            q = q.eq("owner_id", owner_id)
        return q.limit(limit).execute().data or []
    return await asyncio.to_thread(_q)


async def _count_scheduled(owner_id: str | None) -> int:
    def _q():
        now_iso = datetime.now(timezone.utc).isoformat()
        q = (
            db().table("v8_leads").select("id")
            .eq("status", "aguardando_resultado")
            .gt("proxima_tentativa", now_iso)
        )
        if owner_id:
            q = q.eq("owner_id", owner_id)
        return len(q.execute().data or [])
    return await asyncio.to_thread(_q)


async def start_bot(
    num_workers: int,
    on_event: Callable,
    num_retry_workers: int = 3,
    owner_id: str | None = None,
    initiator_id: str | None = None,
):
    global _running, _run_task, _full_tasks, _retry_tasks, _pending_queue, _retry_queue, _inflight
    if _running:
        return {"status": "already_running"}

    _running = True
    _pending_queue = asyncio.Queue()
    _retry_queue = asyncio.Queue()
    _inflight = set()
    redis = await get_redis()
    await redis.set("bot:status", "running")
    await _broadcast(redis, {
        "type": "bot_status", "status": "running",
        "full_workers": num_workers, "retry_workers": num_retry_workers,
        "owner_id": owner_id,
    })

    run_id = str(uuid.uuid4())
    await asyncio.to_thread(
        lambda: db().table("v8_bot_runs").insert({
            "id": run_id, "num_workers": num_workers + num_retry_workers, "status": "running",
            "owner_id": initiator_id,
        }).execute()
    )

    processed = {"count": 0}

    async def on_event_async(event):
        if event["type"] == "lead_result":
            processed["count"] += 1
        await _broadcast(redis, event)
        on_event(event)

    def on_event_wrapper(event):
        asyncio.create_task(on_event_async(event))

    async def _consume(worker_id: int, queue: asyncio.Queue, role: str, role_index: int):
        worker = LeadWorker(worker_id, redis, on_event_wrapper, role=role, role_index=role_index)
        while _running:
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
                logger.exception(f"Worker[{role}] {worker_id} crash CPF {cpf}: {e}")
            finally:
                _inflight.discard(cpf)
                queue.task_done()

    async def cerebro_loop():
        """Coordenador: monitora filas, dispatcha leads e emite telemetria."""
        idle_ticks = 0
        while _running:
            try:
                # 1. Coletar trabalho
                retries = await _fetch_retries(RETRY_BATCH, owner_id)
                pendentes = await _fetch_pending(PENDING_BATCH, owner_id)

                # 2. Dispatch — retries para retry_queue, pendentes para pending_queue
                added_retry = 0
                for lead in retries:
                    cpf = lead.get("cpf")
                    if cpf in _inflight:
                        continue
                    _inflight.add(cpf)
                    await _retry_queue.put(lead)
                    added_retry += 1

                added_pending = 0
                for lead in pendentes:
                    cpf = lead.get("cpf")
                    if cpf in _inflight:
                        continue
                    _inflight.add(cpf)
                    await _pending_queue.put(lead)
                    added_pending += 1

                # 3. Telemetria do cérebro
                scheduled = await _count_scheduled(owner_id)
                await _broadcast(redis, {
                    "type": "cerebro_status",
                    "worker_name": "SUPERVISOR",
                    "worker_role": "supervisor",
                    "ts": datetime.now(timezone.utc).isoformat(),
                    "pending_queue": _pending_queue.qsize(),
                    "retry_queue": _retry_queue.qsize(),
                    "inflight": len(_inflight),
                    "scheduled_retries": scheduled,
                    "added_pending": added_pending,
                    "added_retry": added_retry,
                    "full_pool": num_workers,
                    "retry_pool": num_retry_workers,
                })

                # 4. Encerramento: tudo zerado e nada agendado
                if (
                    added_pending == 0 and added_retry == 0
                    and _pending_queue.empty() and _retry_queue.empty()
                    and not _inflight and scheduled == 0
                ):
                    idle_ticks += 1
                    if idle_ticks >= 2:
                        return
                else:
                    idle_ticks = 0

                # 5. Cadência
                if added_pending == 0 and added_retry == 0 and scheduled > 0:
                    await asyncio.sleep(IDLE_INTERVAL)
                else:
                    await asyncio.sleep(CEREBRO_INTERVAL if added_retry else REFILL_INTERVAL)
            except asyncio.CancelledError:
                raise
            except Exception as e:
                logger.exception(f"cerebro_loop error: {e}")
                await asyncio.sleep(REFILL_INTERVAL)

    async def _run():
        global _running, _full_tasks, _retry_tasks
        try:
            _full_tasks = [
                asyncio.create_task(_consume(i, _pending_queue, "full", i))
                for i in range(num_workers)
            ]
            _retry_tasks = [
                asyncio.create_task(_consume(1000 + i, _retry_queue, "retry", i))
                for i in range(num_retry_workers)
            ]
            cerebro = asyncio.create_task(cerebro_loop())
            await cerebro
            await _pending_queue.join()
            await _retry_queue.join()
        except asyncio.CancelledError:
            logger.info("bot run cancelled")
        finally:
            _running = False
            for t in _full_tasks + _retry_tasks:
                t.cancel()
            await asyncio.gather(*_full_tasks, *_retry_tasks, return_exceptions=True)
            _full_tasks = []
            _retry_tasks = []

            def _finalize():
                q = db().table("v8_leads").select("status")
                if owner_id:
                    q = q.eq("owner_id", owner_id)
                stats = q.execute().data or []
                eleg = sum(1 for r in stats if r["status"] == "elegivel")
                ineleg = sum(1 for r in stats if r["status"] == "inelegivel")
                db().table("v8_bot_runs").update({
                    "status": "completed",
                    "finished_at": datetime.now(timezone.utc).isoformat(),
                    "total_processed": processed["count"],
                    "total_elegiveis": eleg,
                    "total_inelegiveis": ineleg,
                }).eq("id", run_id).execute()
            try:
                await asyncio.to_thread(_finalize)
            except Exception as e:
                logger.warning(f"finalize bot_run failed: {e}")
            await redis.set("bot:status", "idle")
            await _broadcast(redis, {"type": "bot_status", "status": "idle"})

    _run_task = asyncio.create_task(_run())
    return {"status": "started", "full_workers": num_workers, "retry_workers": num_retry_workers}


async def stop_bot():
    global _running, _run_task
    _running = False
    if _run_task:
        _run_task.cancel()
        try:
            await asyncio.wait_for(_run_task, timeout=10)
        except (asyncio.CancelledError, asyncio.TimeoutError):
            pass
    redis = await get_redis()
    await redis.set("bot:status", "idle")
    await _broadcast(redis, {"type": "bot_status", "status": "idle"})
    return {"status": "stopped"}


async def get_bot_status():
    redis = await get_redis()
    status = await redis.get("bot:status") or "idle"
    return {"status": status}
