"""Polling loop que executa scheduled_jobs quando chegam no horário."""
import asyncio
import logging
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

_task: asyncio.Task | None = None


async def _tick(app):
    from ..database import get_db
    from ..services import bot_service
    from ..banks.v8.credentials_helper import get_v8_runtime_creds

    db = get_db()
    now_iso = datetime.now(timezone.utc).isoformat()

    due = (
        db.table("scheduled_jobs")
        .select("id,owner_id,action,scheduled_at,num_workers,batch_id")
        .eq("status", "pending")
        .lte("scheduled_at", now_iso)
        .execute()
        .data or []
    )

    for job in due:
        job_id = job["id"]
        user_id = job["owner_id"]
        action = job["action"]
        try:
            if action == "start":
                creds = get_v8_runtime_creds(user_id, db)
                pool = app.state.v8_pool
                await bot_service.start_bot(
                    pool=pool,
                    user_id=user_id,
                    num_workers=job.get("num_workers") or 6,
                    creds=creds,
                    db=db,
                    on_event=lambda e: None,
                    num_retry_workers=3,
                    batch_id=job.get("batch_id"),
                )
            elif action == "stop":
                pool = app.state.v8_pool
                await bot_service.stop_bot(pool, user_id)

            db.table("scheduled_jobs").update({
                "status": "executed",
                "executed_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", job_id).execute()
            logger.info("scheduled_job %s (%s) executado para user %s", job_id, action, user_id)
        except Exception as e:
            db.table("scheduled_jobs").update({
                "status": "failed",
                "executed_at": datetime.now(timezone.utc).isoformat(),
                "error": str(e)[:500],
            }).eq("id", job_id).execute()
            logger.error("scheduled_job %s falhou: %s", job_id, e)


async def scheduler_loop(app):
    logger.info("Scheduler iniciado — polling a cada 30s")
    while True:
        await asyncio.sleep(30)
        try:
            await _tick(app)
        except Exception as e:
            logger.error("Scheduler tick erro: %s", e)


def start(app):
    global _task
    _task = asyncio.create_task(scheduler_loop(app))


def stop():
    global _task
    if _task:
        _task.cancel()
        _task = None
