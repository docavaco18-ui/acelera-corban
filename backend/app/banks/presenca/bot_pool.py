"""PresencaBotPool — mesma arquitetura VCTexBotPool."""
import asyncio
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable
from fastapi import HTTPException

from ...config import settings


def _max_per_user() -> int: return getattr(settings, "presenca_max_workers_per_user", 2)
def _max_total()   -> int: return getattr(settings, "presenca_max_total_workers", 8)


@dataclass
class PresencaRunHandle:
    user_id: str
    run_id: str
    num_workers: int
    started_at: datetime
    tasks: list[asyncio.Task] = field(default_factory=list)
    listeners: list[Callable] = field(default_factory=list)


class PresencaBotPool:
    def __init__(self):
        self._runs: dict[str, PresencaRunHandle] = {}
        self._lock = asyncio.Lock()

    async def start(self, user_id: str, num_workers: int, creds: Any, db: Any) -> PresencaRunHandle:
        async with self._lock:
            if user_id in self._runs:
                raise HTTPException(status_code=409, detail="bot Presença Bank já em execução")
            n = max(1, min(num_workers, _max_per_user()))
            running_total = sum(r.num_workers for r in self._runs.values())
            if running_total + n > _max_total():
                raise HTTPException(
                    status_code=503,
                    detail=f"capacidade Presença cheia ({running_total}/{_max_total()}). Tente em instantes.",
                )
            run_id = await self._persist_run(user_id, n, db)
            handle = PresencaRunHandle(
                user_id=user_id, run_id=run_id, num_workers=n,
                started_at=datetime.now(timezone.utc),
            )
            self._runs[user_id] = handle
        return handle

    async def stop(self, user_id: str) -> None:
        async with self._lock:
            handle = self._runs.pop(user_id, None)
        if not handle:
            return
        for t in handle.tasks:
            t.cancel()

    def status(self, user_id: str) -> PresencaRunHandle | None:
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
            lambda: scoped(db, "presenca_bot_runs", user_id).insert({
                "num_workers": n,
                "status": "running",
            }).execute()
        )
        return resp.data[0]["id"]
