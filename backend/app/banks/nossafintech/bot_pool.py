"""NossaFintechBotPool — mesma arquitetura PresencaBotPool/VCTexBotPool."""
import asyncio
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable
from fastapi import HTTPException

from ...config import settings


def _max_per_user() -> int: return getattr(settings, "nossafintech_max_workers_per_user", 4)
def _max_total()   -> int: return getattr(settings, "nossafintech_max_total_workers", 12)


@dataclass
class NossaFintechRunHandle:
    user_id: str
    run_id: str
    num_workers: int
    started_at: datetime
    tasks: list[asyncio.Task] = field(default_factory=list)
    listeners: list[Callable] = field(default_factory=list)


class NossaFintechBotPool:
    def __init__(self):
        self._runs: dict[str, NossaFintechRunHandle] = {}
        self._lock = asyncio.Lock()

    async def start(self, user_id: str, num_workers: int, creds: Any, db: Any) -> NossaFintechRunHandle:
        async with self._lock:
            if user_id in self._runs:
                raise HTTPException(status_code=409, detail="bot Nossa Fintech já em execução")
            n = max(1, min(num_workers, _max_per_user()))
            running_total = sum(r.num_workers for r in self._runs.values())
            if running_total + n > _max_total():
                raise HTTPException(
                    status_code=503,
                    detail=f"capacidade Nossa Fintech cheia ({running_total}/{_max_total()}). Tente em instantes.",
                )
            run_id = await self._persist_run(user_id, n, db)
            handle = NossaFintechRunHandle(
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

    def status(self, user_id: str) -> NossaFintechRunHandle | None:
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
            lambda: scoped(db, "nossafintech_bot_runs", user_id).insert({
                "num_workers": n,
                "status": "running",
            }).execute()
        )
        if not resp.data:
            raise RuntimeError("nossafintech _persist_run: insert retornou vazio (constraint violation?)")
        return resp.data[0]["id"]
