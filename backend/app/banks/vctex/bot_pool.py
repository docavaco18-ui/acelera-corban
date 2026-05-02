"""VCTexBotPool — paralelo ao V8BotPool, com tetos próprios (Chromium pesa)."""
import asyncio
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable
from fastapi import HTTPException

from ...config import settings


def _settings_max_per_user() -> int: return settings.vctex_max_workers_per_user
def _settings_max_total()   -> int: return settings.vctex_max_total_workers


@dataclass
class VCTexRunHandle:
    user_id: str
    run_id: str
    num_workers: int
    started_at: datetime
    tasks: list[asyncio.Task] = field(default_factory=list)
    listeners: list[Callable] = field(default_factory=list)


class VCTexBotPool:
    def __init__(self):
        self._runs: dict[str, VCTexRunHandle] = {}
        self._lock = asyncio.Lock()

    async def start(self, user_id: str, num_workers: int, creds: Any, db: Any) -> VCTexRunHandle:
        async with self._lock:
            if user_id in self._runs:
                raise HTTPException(status_code=409, detail="bot VCTex já em execução")
            n = max(1, min(num_workers, _settings_max_per_user()))
            running_total = sum(r.num_workers for r in self._runs.values())
            if running_total + n > _settings_max_total():
                raise HTTPException(
                    status_code=503,
                    detail=f"capacidade VCTex cheia ({running_total}/{_settings_max_total()}). Tente em instantes.",
                )
            run_id = await self._persist_run(user_id, n, db)
            handle = VCTexRunHandle(user_id=user_id, run_id=run_id, num_workers=n,
                                    started_at=datetime.now(timezone.utc))
            self._runs[user_id] = handle
        await self._spawn_workers(handle, creds, db)
        return handle

    async def stop(self, user_id: str) -> None:
        async with self._lock:
            handle = self._runs.pop(user_id, None)
        if not handle:
            return
        for t in handle.tasks:
            t.cancel()

    def status(self, user_id: str) -> VCTexRunHandle | None:
        return self._runs.get(user_id)

    def emit(self, user_id: str, event: dict) -> None:
        handle = self._runs.get(user_id)
        if not handle:
            return
        for listener in handle.listeners:
            try:
                listener(event)
            except Exception:
                pass

    async def _persist_run(self, user_id: str, n: int, db: Any) -> str:
        from ...db_scoped import scoped
        resp = await asyncio.to_thread(
            lambda: scoped(db, "vctex_bot_runs", user_id).insert({
                "num_workers": n,
                "status": "running",
            }).execute()
        )
        return resp.data[0]["id"]

    async def _spawn_workers(self, handle: VCTexRunHandle, creds: Any, db: Any) -> None:
        # Conectado pelo vctex_bot_service (igual V8 — separação de concerns)
        pass
