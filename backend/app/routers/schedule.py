from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from ..auth_deps import require_user, AuthUser
from ..database import get_db
from ..db_scoped import scoped

router = APIRouter(prefix="/api/schedule", tags=["schedule"])


class CreateJobRequest(BaseModel):
    action: str          # 'start' | 'stop'
    scheduled_at: str    # ISO8601
    num_workers: int = 6
    batch_id: str | None = None


@router.get("/jobs")
async def list_jobs(user: AuthUser = Depends(require_user)):
    db = get_db()
    rows = (
        scoped(db, "scheduled_jobs", user.user_id)
        .select("id,action,scheduled_at,num_workers,batch_id,status,executed_at,error,created_at")
        .order("scheduled_at", desc=False)
        .limit(50)
        .execute()
        .data or []
    )
    return {"jobs": rows}


@router.post("/jobs")
async def create_job(body: CreateJobRequest, user: AuthUser = Depends(require_user)):
    if body.action not in ("start", "stop"):
        raise HTTPException(400, "action deve ser 'start' ou 'stop'")
    try:
        dt = datetime.fromisoformat(body.scheduled_at.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(400, "scheduled_at inválido — use ISO8601")
    if dt <= datetime.now(timezone.utc):
        raise HTTPException(400, "scheduled_at deve ser no futuro")

    db = get_db()
    row = (
        scoped(db, "scheduled_jobs", user.user_id)
        .insert({
            "action": body.action,
            "scheduled_at": body.scheduled_at,
            "num_workers": body.num_workers if body.action == "start" else None,
            "batch_id": body.batch_id,
            "status": "pending",
        })
        .execute()
        .data[0]
    )
    return row


@router.delete("/jobs/{job_id}")
async def cancel_job(job_id: str, user: AuthUser = Depends(require_user)):
    db = get_db()
    rows = (
        scoped(db, "scheduled_jobs", user.user_id)
        .eq("id", job_id)
        .eq("status", "pending")
        .update({"status": "cancelled"})
        .execute()
        .data or []
    )
    if not rows:
        raise HTTPException(404, "Job não encontrado ou já executado/cancelado")
    return {"ok": True}
