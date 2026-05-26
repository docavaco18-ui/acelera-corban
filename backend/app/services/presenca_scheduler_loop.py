"""Scheduler loop pra Presença — dispara start_bot automaticamente em batches agendados.

Padrão copiado de broadcast/monitor_loop.py: Redis SETNX leader election + tick 60s.
Lê batches WHERE status='pendente' AND scheduled_for IS NOT NULL AND scheduled_for <= NOW().
Pra cada match: skip se pool já tem bot rodando pro user, senão carrega creds + start_bot.
"""
from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timezone

import redis.asyncio as aioredis

from ..credentials.service import CredentialService
from ..database import db as get_db
from . import presenca_bot_service

logger = logging.getLogger(__name__)

POLL_INTERVAL = 60
LOCK_KEY = "presenca:scheduler_lock"
DEFAULT_WORKERS = 2
DEFAULT_MODE = "api"


async def scheduler_tick(app, redis_client: aioredis.Redis) -> None:
    """Um tick: busca batches due e dispara start_bot pra cada owner não-running."""
    db = get_db()
    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        resp = (
            db.table("presenca_batches")
            .select("id, owner_id, scheduled_for")
            .eq("status", "pendente")
            .not_.is_("scheduled_for", "null")
            .lte("scheduled_for", now_iso)
            .order("scheduled_for")
            .limit(50)
            .execute()
        )
    except Exception as e:
        logger.exception(f"presenca scheduler query failed: {e}")
        return

    rows = resp.data or []
    if not rows:
        return

    pool = app.state.presenca_pool
    cred_svc = CredentialService(db)

    seen_owners: set[str] = set()
    for row in rows:
        owner_id = row["owner_id"]
        batch_id = row["id"]
        # Pool é single-bot-per-user — se já tem run, deixa pra próximo tick
        if pool.status(owner_id) is not None:
            continue
        # Só dispara um batch por owner por tick (start_bot cobre fila inteira)
        if owner_id in seen_owners:
            continue
        seen_owners.add(owner_id)
        creds = cred_svc.get(owner_id, "presenca")
        if creds is None or not creds.login or not creds.password:
            logger.warning(
                f"presenca scheduler skip batch={batch_id} owner={owner_id}: sem credenciais"
            )
            continue
        try:
            await presenca_bot_service.start_bot(
                pool=pool,
                user_id=owner_id,
                num_workers=DEFAULT_WORKERS,
                creds=creds,
                db=db,
                on_event=_noop_event,
                batch_id=batch_id,
                mode=DEFAULT_MODE,
            )
            # Limpa scheduled_for pra evitar re-fire se batch voltar a 'pendente'
            # (ex: retry-errors). Sem isso, scheduler dispara de novo no próximo tick.
            try:
                db.table("presenca_batches").update({"scheduled_for": None}).eq(
                    "id", batch_id
                ).execute()
            except Exception as clr:
                logger.warning(
                    f"presenca scheduler clear scheduled_for failed batch={batch_id}: {clr}"
                )
            logger.info(
                f"presenca scheduler fired batch={batch_id} owner={owner_id} "
                f"scheduled_for={row['scheduled_for']}"
            )
        except Exception as e:
            logger.exception(
                f"presenca scheduler start_bot failed batch={batch_id} owner={owner_id}: {e}"
            )


def _noop_event(event: dict) -> None:
    pass


async def run_presenca_scheduler_loop(app, redis_client: aioredis.Redis) -> None:
    """Leader-elected loop — só uma instância do backend dispara batches."""
    worker_id = str(os.getpid())
    logger.info(f"presenca scheduler standby — worker {worker_id}")

    while True:
        try:
            current = await redis_client.get(LOCK_KEY)
            current_val = current.decode() if isinstance(current, bytes) else current

            if current_val == worker_id:
                await redis_client.expire(LOCK_KEY, POLL_INTERVAL * 3)
                await scheduler_tick(app, redis_client)
            elif current_val is None:
                acquired = await redis_client.set(
                    LOCK_KEY, worker_id, ex=POLL_INTERVAL * 3, nx=True
                )
                if acquired:
                    logger.info(f"presenca scheduler leader elected: worker {worker_id}")
                    await scheduler_tick(app, redis_client)
        except Exception as e:
            logger.exception(f"presenca scheduler tick error: {e}")
        await asyncio.sleep(POLL_INTERVAL)
