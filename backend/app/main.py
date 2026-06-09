import traceback
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from .config import settings
from .logging_config import setup_logging
from .routers import leads, bot, stats, webhook, ws, admin, batches, crm, chatwoot, command_center
from .routers import vctex as vctex_router
from .routers import mercantil as mercantil_router
from .routers import presenca as presenca_router
from .routers import v8_proposals
from .routers import broadcast as broadcast_router
from .routers import powerhub as powerhub_router
from .routers import aesir_broadcast as aesir_broadcast_router
from .routers import chipcare_broadcast as chipcare_broadcast_router
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


# NOTE: Admin credential seed removido em 2026-06-05.
# Regra SaaS: ZERO pré-save de credenciais. Cada usuário (localhost ou VPS)
# digita seu próprio email/senha CRM + token Meta System User na UI.
# Toda credencial é armazenada por owner_id no Supabase com RLS ativo.
# As env vars ADMIN_* foram descontinuadas — não usar em código novo.


@app.on_event("startup")
async def _sweep_stale_chatwoot_runs():
    """Marca como 'failed' qualquer chatwoot_sync_runs deixado em 'running' por restart."""
    try:
        from .database import db as get_db
        from datetime import datetime, timezone
        now_iso = datetime.now(timezone.utc).isoformat()
        get_db().table("chatwoot_sync_runs").update({
            "status": "failed",
            "finished_at": now_iso,
            "error": "interrupted by restart",
        }).eq("status", "running").execute()
        # Aesir: in-memory tasks vanish on restart — mark orphaned running dispatches
        get_db().table("aesir_dispatches").update({
            "status": "error",
            "updated_at": now_iso,
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
    allow_origins=[o.strip() for o in settings.cors_origins.split(",")],
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
app.include_router(aesir_broadcast_router.router)
app.include_router(chipcare_broadcast_router.router)
app.include_router(command_center.router)

@app.exception_handler(Exception)
async def _unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    import logging
    logging.getLogger("acelera").error("Unhandled exception: %s", traceback.format_exc())
    origin = request.headers.get("origin", "")
    allowed = [o.strip() for o in settings.cors_origins.split(",")]
    headers = {"Access-Control-Allow-Credentials": "true"}
    if origin in allowed:
        headers["Access-Control-Allow-Origin"] = origin
    return JSONResponse(
        status_code=500,
        content={"detail": "Erro interno do servidor. Tente novamente."},
        headers=headers,
    )


@app.get("/health")
@app.get("/api/health")
async def health():
    return {"status": "ok"}
