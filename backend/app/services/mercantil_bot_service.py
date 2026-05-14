"""Mercantil bot service — espelha vctex_bot_service.py.

Diferenças importantes:
- EVENT_CHANNEL = "bot:events" para o frontend WS receber direto
  (ws.py subscreve bot:events + broadcast:events).
- Status enum diferente do VCTex: pendente, fase1_consulta, fase2_check_auth,
  fase3_dataprev, aguardando_autorizacao, fase4_simular, elegivel, inelegivel, erro.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os as _os
import uuid as _uuid_mod
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path as _Path
from typing import Any, Callable

_timezone = timezone  # alias for new functions

from ..redis_client import get_redis
from ..db_scoped import scoped
from ..banks.mercantil.worker import MercantilLeadWorker
from ..banks.mercantil.bot_pool import MercantilBotPool, MercantilRunHandle
from ..banks.mercantil.config import MercantilConfig

logger = logging.getLogger(__name__)

_STATE_DIR_PATH = _Path(_os.getenv("MERCANTIL_STATE_DIR", ".bot_state/mercantil"))

REFILL_INTERVAL = 5
PENDING_BATCH = 50
EVENT_CHANNEL = "bot:events"  # frontend WS escuta esse channel
WORKER_STAGGER_SECONDS = 2.0

PENDING_STATUSES = [
    "pendente",
    "fase1_consulta",
    "fase2_check_auth",
    "fase3_dataprev",
    "fase4_simular",
    "aguardando_autorizacao",
    "erro",
]


@dataclass
class _Runtime:
    running: bool = True
    queue: asyncio.Queue = field(default_factory=asyncio.Queue)
    inflight: set[str] = field(default_factory=set)
    worker_tasks: list[asyncio.Task] = field(default_factory=list)
    run_task: asyncio.Task | None = None
    stop_event: asyncio.Event = field(default_factory=asyncio.Event)


_runtimes: dict[str, _Runtime] = {}


def get_session_status(user_id: str) -> dict:
    """Returns saved session state for the user."""
    path = _STATE_DIR_PATH / f"{user_id}.json"
    try:
        st = path.stat()
    except (FileNotFoundError, OSError):
        return {"status": "none", "saved_at": None}
    if st.st_size < 10:
        return {"status": "none", "saved_at": None}
    mtime = datetime.fromtimestamp(st.st_mtime, tz=_timezone.utc)
    return {"status": "valid", "saved_at": mtime.isoformat()}


async def start_login_visual(
    pool,
    user_id: str,
    creds: dict,
    on_event,
    db=None,
) -> dict:
    """Starts headful Playwright browser for login+SMS only. Does NOT process leads.
    Emits session_saved on success, session_failed on failure."""
    redis = await get_redis()

    lv_key = f"mercantil:login_visual:{user_id}"
    if await redis.exists(lv_key):
        return {"status": "already_running", "message": "Login visual já em andamento"}

    run_id = str(_uuid_mod.uuid4())
    await redis.setex(lv_key, 600, run_id)

    if db:
        try:
            now = datetime.now(_timezone.utc).isoformat()
            db.table("mercantil_bot_runs").insert({
                "id": run_id,
                "owner_id": user_id,
                "status": "login_visual",
                "started_at": now,
            }).execute()
        except Exception as e:
            logger.warning("login_visual: erro ao criar run no DB: %s", e)

    async def _login_task():
        from ..banks.mercantil.engine import MercantilEngine
        from ..banks.mercantil.config import MercantilConfig

        engine = MercantilEngine(
            login=creds["login"],
            password=creds["password"],
            config=MercantilConfig(),
        )
        try:
            await engine.start(headless=False)
            ctx = await engine.new_context(user_id)
            page = await ctx.new_page()

            def _emit(ev):
                on_event({**ev, "user_id": user_id, "run_id": run_id, "bank": "mercantil"})

            success = await engine.login_with_sms(page, user_id, run_id, emit=_emit)

            if success:
                await engine._save_state(ctx, user_id)
                on_event({
                    "type": "session_saved",
                    "user_id": user_id,
                    "run_id": run_id,
                    "bank": "mercantil",
                })
                logger.info("login_visual: sessão salva com sucesso user=%s", user_id)
            else:
                on_event({
                    "type": "session_failed",
                    "user_id": user_id,
                    "run_id": run_id,
                    "bank": "mercantil",
                })
                logger.warning("login_visual: falha no login user=%s", user_id)
        except Exception as e:
            logger.exception("login_visual: erro inesperado user=%s: %s", user_id, e)
            on_event({
                "type": "session_failed",
                "user_id": user_id,
                "run_id": run_id,
                "bank": "mercantil",
                "error": str(e),
            })
        finally:
            await engine.stop()
            redis2 = await get_redis()
            await redis2.delete(lv_key)

    asyncio.create_task(_login_task())
    return {"status": "started", "run_id": run_id}


async def _broadcast(redis, event: dict) -> None:
    await redis.publish(EVENT_CHANNEL, json.dumps(event))


async def _fetch_pending(db: Any, user_id: str, limit: int, batch_id: str | None = None) -> list[dict]:
    def _q():
        q = scoped(db, "mercantil_leads", user_id).select("*").in_("status", PENDING_STATUSES)
        if batch_id is not None:
            q = q.eq("batch_id", batch_id)
        return q.limit(limit).execute().data or []

    rows = await asyncio.to_thread(_q)

    if not rows and batch_id is not None:
        logger.warning("mercantil batch %s vazia, buscando leads sem filtro de batch", batch_id)
        def _q_all():
            return scoped(db, "mercantil_leads", user_id).select("*").in_(
                "status", PENDING_STATUSES
            ).limit(limit).execute().data or []
        rows = await asyncio.to_thread(_q_all)

    return rows


async def start_bot(
    pool: MercantilBotPool,
    user_id: str,
    num_workers: int,
    creds: Any,
    db: Any,
    on_event: Callable,
    batch_id: str | None = None,
):
    """Inicia bot Mercantil pra um user, opcionalmente escopado pra batch."""
    if user_id in _runtimes:
        return {"status": "already_running"}

    handle = await pool.start(user_id=user_id, num_workers=num_workers, creds=creds, db=db)
    rt = _Runtime()
    _runtimes[user_id] = rt
    redis = await get_redis()

    await _broadcast(redis, {
        "type": "bot_status", "status": "running", "user_id": user_id,
        "bank": "mercantil", "full_workers": handle.num_workers,
        "run_id": handle.run_id, "batch_id": batch_id,
    })

    if batch_id is not None:
        try:
            def _mark_running():
                scoped(db, "mercantil_batches", user_id).update({
                    "status": "processando",
                    "started_at": datetime.now(timezone.utc).isoformat(),
                }).eq("id", batch_id).execute()
            await asyncio.to_thread(_mark_running)
        except Exception as e:
            logger.warning("mercantil mark batch processando[%s] failed: %s", batch_id, e)

    processed = {"count": 0, "eleg": 0, "ineleg": 0}

    async def on_event_async(event: dict):
        if event.get("type") == "lead_result":
            processed["count"] += 1
            st = event.get("status") or ""
            if st == "elegivel":
                processed["eleg"] += 1
            elif st == "inelegivel":
                processed["ineleg"] += 1
            cpf_done = event.get("cpf")
            if cpf_done:
                rt.inflight.discard(cpf_done)
        await _broadcast(redis, {**event, "bank": "mercantil"})
        try:
            on_event(event)
        except Exception:
            logger.exception("mercantil on_event router callback failed")
        pool.emit(user_id, event)

    def on_event_wrapper(event):
        asyncio.create_task(on_event_async(event))

    cfg = MercantilConfig()

    async def _refill_queue():
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

                logger.info(
                    "mercantil refill[%s] fetched=%d added=%d queue=%d inflight=%d batch=%s",
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
                logger.exception("mercantil refill[%s] error: %s", user_id, e)
                await asyncio.sleep(REFILL_INTERVAL)

    async def _run():
        try:
            for i in range(handle.num_workers):
                w = MercantilLeadWorker(
                    worker_id=i, user_id=user_id, run_id=handle.run_id,
                    creds=creds, db=db,
                    on_event=on_event_wrapper,
                    startup_delay=i * WORKER_STAGGER_SECONDS,
                    batch_id=batch_id,
                    config=cfg,
                )

                async def _wrap(worker=w):
                    try:
                        await worker.run(rt.queue, stop_event=rt.stop_event)
                    except asyncio.CancelledError:
                        raise
                    except Exception:
                        logger.exception("mercantil worker_%d CRASHED", worker.worker_id)
                    finally:
                        logger.info("mercantil worker_%d encerrou", worker.worker_id)
                        active = [t for t in rt.worker_tasks if not t.done()]
                        if len(active) <= 1:
                            rt.inflight.clear()
                            logger.info("mercantil todos workers encerraram; inflight limpo")

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
            logger.info("mercantil bot run[%s] cancelled", user_id)
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
                scoped(db, "mercantil_bot_runs", user_id).update({
                    "status": "completed",
                    "finished_at": now_iso,
                    "total_processed": processed["count"],
                    "total_elegiveis": eleg,
                    "total_inelegiveis": ineleg,
                }).eq("id", handle.run_id).execute()
                if batch_id is not None:
                    rows = (
                        scoped(db, "mercantil_leads", user_id)
                        .select("status,valor_liberado")
                        .eq("batch_id", batch_id)
                        .execute().data or []
                    )
                    liberado = sum(float(r.get("valor_liberado") or 0)
                                   for r in rows if r["status"] == "elegivel")
                    scoped(db, "mercantil_batches", user_id).update({
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
                logger.warning("mercantil finalize[%s] failed: %s", user_id, e)
            await _broadcast(redis, {
                "type": "bot_status", "status": "idle",
                "user_id": user_id, "bank": "mercantil",
            })
            _runtimes.pop(user_id, None)
            try:
                await pool.stop(user_id)
            except Exception:
                pass

    rt.run_task = asyncio.create_task(_run())
    return {
        "status": "started", "bank": "mercantil",
        "run_id": handle.run_id, "full_workers": handle.num_workers,
    }


async def stop_bot(pool: MercantilBotPool, user_id: str):
    rt = _runtimes.get(user_id)
    if not rt:
        await pool.stop(user_id)
        return {"status": "not_running", "bank": "mercantil"}
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
                             "user_id": user_id, "bank": "mercantil"})
    return {"status": "stopped", "bank": "mercantil"}


async def get_bot_status(pool: MercantilBotPool, user_id: str):
    handle = pool.status(user_id)
    if handle is None:
        return {"status": "idle", "bank": "mercantil"}
    return {
        "status": "running",
        "bank": "mercantil",
        "run_id": handle.run_id,
        "num_workers": handle.num_workers,
        "started_at": handle.started_at.isoformat(),
    }
