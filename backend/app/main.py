from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .config import settings
from .logging_config import setup_logging
from .routers import leads, bot, stats, webhook, ws, admin, batches, crm, chatwoot
from .routers import vctex as vctex_router
from .routers import v8_proposals
from .routers import broadcast as broadcast_router
from .credentials.router import router as credentials_router
from .banks.v8.bot_pool import V8BotPool
from .banks.vctex.bot_pool import VCTexBotPool

setup_logging(json_logs=True)

app = FastAPI(title="V8 CLT Higienização", version="1.0.0")
app.state.v8_pool = V8BotPool()
app.state.vctex_pool = VCTexBotPool()


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
    redis_client = await get_redis()
    asyncio.create_task(run_monitor_loop(redis_client))

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
app.include_router(crm.router)
app.include_router(v8_proposals.router)
app.include_router(chatwoot.router)
app.include_router(broadcast_router.router)

@app.get("/health")
@app.get("/api/health")
async def health():
    return {"status": "ok"}
