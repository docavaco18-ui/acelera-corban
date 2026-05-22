"""PowerHub bot service — inicia workers de enriquecimento."""
from __future__ import annotations
import asyncio
from typing import Any, Callable

from ..banks.powerhub.api_worker import PowerHubApiWorker
from ..credentials.service import BankCredentials


async def start_bot(
    pool,
    user_id: str,
    creds: BankCredentials,
    db: Any,
    num_workers: int = 3,
    batch_id: str | None = None,
    on_event: Callable | None = None,
) -> dict:
    handle = await pool.start(user_id, num_workers, creds, db)

    tasks = []
    for i in range(handle.num_workers):
        worker = PowerHubApiWorker(
            worker_id=i,
            user_id=user_id,
            creds=creds,
            db=db,
            on_event=on_event,
            startup_delay=i * 0.5,
            batch_id=batch_id,
        )
        task = asyncio.create_task(worker.run())
        tasks.append(task)

    handle.tasks = tasks

    async def _finalize():
        await asyncio.gather(*tasks, return_exceptions=True)
        await pool.stop(user_id)

    asyncio.create_task(_finalize())
    return {"run_id": handle.run_id, "num_workers": handle.num_workers}
