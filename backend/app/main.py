from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .config import settings
from .logging_config import setup_logging
from .routers import leads, bot, stats, webhook, ws, admin, batches, crm, chatwoot
from .routers import vctex as vctex_router
from .routers import mercantil as mercantil_router
from .routers import presenca as presenca_router
from .routers import v8_proposals
from .routers import broadcast as broadcast_router
from .routers import powerhub as powerhub_router
from .credentials.router import router as credentials_router
from .banks.v8.bot_pool import V8BotPool
from .banks.vctex.bot_pool import VCTexBotPool
from .banks.mercantil.bot_pool import MercantilBotPool
from .banks.presenca.bot_pool import PresencaBotPool
from .banks.powerhub.bot_pool import PowerHubBotPool

setup_logging(json_logs=True)

app = FastAPI(title="Acelera Corban", version="1.0.0")
app.state.v8_pool = V8BotPool()
app.state.vctex_pool = VCTexBotPool()
app.state.mercantil_pool = MercantilBotPool()
app.state.presenca_pool = PresencaBotPool()
app.state.powerhub_pool = PowerHubBotPool()


@app.on_event("startup")
def _seed_admin_credentials():
    """Seed VendeAI admin credentials from env. Skips silently if any required env var missing.

    Required env: ADMIN_OWNER_ID, ADMIN_VENDEAI_EMAIL, ADMIN_VENDEAI_PASSWORD,
    ADMIN_META_TOKEN, ADMIN_ACCOUNT_ID, ADMIN_CRM_TOKEN.
    """
    import os
    import logging

    _OWNER_ID   = os.getenv("ADMIN_OWNER_ID")
    _EMAIL      = os.getenv("ADMIN_VENDEAI_EMAIL")
    _PASSWORD   = os.getenv("ADMIN_VENDEAI_PASSWORD")
    _META_TOKEN = os.getenv("ADMIN_META_TOKEN")
    _ACCOUNT_ID = os.getenv("ADMIN_ACCOUNT_ID")
    _CRM_TOKEN  = os.getenv("ADMIN_CRM_TOKEN")

    if not all([_OWNER_ID, _EMAIL, _PASSWORD, _META_TOKEN, _ACCOUNT_ID, _CRM_TOKEN]):
        logging.warning("admin_seed_skipped: ADMIN_* env vars ausentes — seed pulado")
        return

    try:
        from .credentials.crypto import encrypt, safe_decrypt
        from .database import db as get_db

        db = get_db()
        res = db.table("vendeai_settings").select("*").eq("owner_id", _OWNER_ID).execute()
        row = res.data[0] if res.data else {}

        needs_update = (
            not res.data
            or safe_decrypt(row.get("email_enc")) != _EMAIL
            or safe_decrypt(row.get("meta_token_enc")) is None
        )
        if not needs_update:
            return

        creds = {
            "email_enc":      encrypt(_EMAIL),
            "password_enc":   encrypt(_PASSWORD),
            "meta_token_enc": encrypt(_META_TOKEN),
            "account_id":     _ACCOUNT_ID,
            "crm_token_enc":  encrypt(_CRM_TOKEN),
        }
        if res.data:
            # update preserva waba_ids e demais colunas não listadas
            db.table("vendeai_settings").update(creds).eq("owner_id", _OWNER_ID).execute()
        else:
            db.table("vendeai_settings").insert({"owner_id": _OWNER_ID, **creds}).execute()
    except Exception as e:
        logging.exception("admin_seed_failed: %s", e)


@app.on_event("startup")
async def _sweep_stale_chatwoot_runs():
    """Marca como 'failed' qualquer chatwoot_sync_runs deixado em 'running' por restart."""
    try:
        from .database import db as get_db
        from datetime import datetime, timezone
        get_db().table("chatwoot_sync_runs").update({
            "status": "failed",
            "finished_at": datetime.now(timezone.utc).isoformat(),
            "error": "interrupted by restart",
        }).eq("status", "running").execute()
    except Exception:
        pass

    import asyncio
    from .redis_client import get_redis
    from .services.broadcast.monitor_loop import run_monitor_loop
    from .services.presenca_scheduler_loop import run_presenca_scheduler_loop
    redis_client = await get_redis()
    asyncio.create_task(run_monitor_loop(redis_client))
    asyncio.create_task(run_presenca_scheduler_loop(app, redis_client))

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins.split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(leads.router)
app.include_router(bot.router)
app.include_router(stats.router)
app.include_router(webhook.router)
app.include_router(ws.router)
app.include_router(admin.router)
app.include_router(credentials_router)
app.include_router(batches.router)
app.include_router(vctex_router.router)
app.include_router(mercantil_router.router)
app.include_router(presenca_router.router)
app.include_router(crm.router)
app.include_router(v8_proposals.router)
app.include_router(chatwoot.router)
app.include_router(broadcast_router.router)
app.include_router(powerhub_router.router)

@app.get("/health")
@app.get("/api/health")
async def health():
    return {"status": "ok"}
