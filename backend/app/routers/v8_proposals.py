"""Sync de propostas pagas do portal V8 para o CRM."""
import asyncio
import logging
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from ..auth_deps import require_user, AuthUser
from ..database import db as get_db
from ..banks.v8.credentials_helper import get_v8_runtime_creds
from ..banks.v8.proposals_scraper import V8ProposalsScraper

router = APIRouter(prefix="/api/v8proposals", tags=["v8proposals"])
logger = logging.getLogger(__name__)

# Job status em memória (por user_id)
_jobs: dict[str, dict] = {}


@router.post("/sync")
async def start_sync(
    background_tasks: BackgroundTasks,
    months_back: int = 12,
    user: AuthUser = Depends(require_user),
):
    """Dispara sync em background. Retorna job_id para polling."""
    if user.user_id in _jobs and _jobs[user.user_id].get("status") == "running":
        return {"status": "already_running", "job_id": user.user_id}

    db = get_db()
    creds = get_v8_runtime_creds(user.user_id, db)

    _jobs[user.user_id] = {"status": "running", "added": 0, "skipped": 0, "errors": 0}

    async def _run():
        try:
            scraper = V8ProposalsScraper(
                user_id=user.user_id,
                login=creds.login,
                password=creds.password,
                db=db,
                months_back=months_back,
            )
            result = await scraper.run()
            _jobs[user.user_id] = {"status": "done", **result}
            logger.info(f"V8 sync concluído para {user.user_id}: {result}")
        except Exception as e:
            logger.exception(f"V8 sync falhou para {user.user_id}: {e}")
            _jobs[user.user_id] = {"status": "error", "detail": str(e)}

    background_tasks.add_task(_run)
    return {"status": "started", "job_id": user.user_id}


@router.get("/sync/status")
def sync_status(user: AuthUser = Depends(require_user)):
    job = _jobs.get(user.user_id)
    if not job:
        return {"status": "idle"}
    return job
