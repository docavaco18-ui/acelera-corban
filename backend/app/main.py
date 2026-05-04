from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .config import settings
from .logging_config import setup_logging
from .routers import leads, bot, stats, webhook, ws, admin, batches
from .routers import vctex as vctex_router
from .credentials.router import router as credentials_router
from .banks.v8.bot_pool import V8BotPool
from .banks.vctex.bot_pool import VCTexBotPool

setup_logging(json_logs=True)

app = FastAPI(title="V8 CLT Higienização", version="1.0.0")
app.state.v8_pool = V8BotPool()
app.state.vctex_pool = VCTexBotPool()

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

@app.get("/health")
async def health():
    return {"status": "ok"}
