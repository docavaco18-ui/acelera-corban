"""Routers VCTex — leads, bot, stats, batches sob /api/vctex/*."""
import csv
import io
from fastapi import APIRouter, UploadFile, File, HTTPException, Depends, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ..auth_deps import require_user, AuthUser
from ..database import db as get_db
from ..db_scoped import scoped
from ..banks.vctex.credentials_helper import get_vctex_runtime_creds
from ..services import vctex_upload_jobs, vctex_bot_service

router = APIRouter(prefix="/api/vctex", tags=["vctex"])
_events: list[dict] = []


def _on_event(event: dict):
    _events.append(event)
    if len(_events) > 500:
        _events.pop(0)


# ─── Leads ──────────────────────────────────────────────────────────────────

@router.post("/leads/upload", status_code=202)
async def upload_csv(
    file: UploadFile = File(...),
    user: AuthUser = Depends(require_user),
):
    content = await file.read()
    if not content:
        raise HTTPException(400, "Arquivo vazio")
    return await vctex_upload_jobs.start_upload(content, user.user_id, file_name=file.filename)


@router.get("/leads/upload/{job_id}")
async def upload_status(job_id: str, _: AuthUser = Depends(require_user)):
    state = await vctex_upload_jobs.get_job(job_id)
    if state is None:
        raise HTTPException(404, "Job não encontrado ou expirado")
    return state


@router.get("/leads/")
async def list_leads(
    status: str = None,
    batch_id: str | None = None,
    page: int = 1,
    limit: int = 50,
    user: AuthUser = Depends(require_user),
):
    db = get_db()
    q = scoped(db, "vctex_leads", user.user_id).select("*").order("created_at", desc=True)
    if status:
        q = q.eq("status", status)
    if batch_id:
        q = q.eq("batch_id", batch_id)
    result = q.range((page - 1) * limit, page * limit - 1).execute()
    return {"data": result.data, "page": page}


@router.get("/leads/export")
async def export_csv(
    status: str = "elegivel",
    user: AuthUser = Depends(require_user),
):
    db = get_db()
    result = scoped(db, "vctex_leads", user.user_id).select("*").eq("status", status).execute()
    leads = result.data
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=[
        "cpf", "nome", "telefone", "status", "valor_liberado", "erro",
    ])
    writer.writeheader()
    for lead in leads:
        writer.writerow({k: lead.get(k, "") for k in writer.fieldnames})
    output.seek(0)
    return StreamingResponse(
        io.BytesIO(output.getvalue().encode()),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=vctex_{status}.csv"},
    )


# ─── Bot ────────────────────────────────────────────────────────────────────

@router.post("/bot/start")
async def bot_start(
    request: Request,
    num_workers: int = 2,
    batch_id: str | None = None,
    user: AuthUser = Depends(require_user),
):
    db = get_db()
    creds = get_vctex_runtime_creds(user.user_id, db)
    pool = request.app.state.vctex_pool
    v8_pool = request.app.state.v8_pool
    if v8_pool.status(user.user_id) is not None:
        raise HTTPException(409, "Bot V8 já em execução. Pare-o antes de iniciar o VCTex.")
    return await vctex_bot_service.start_bot(
        pool=pool, user_id=user.user_id, num_workers=num_workers,
        creds=creds, db=db, on_event=_on_event, batch_id=batch_id,
    )


@router.post("/bot/stop")
async def bot_stop(request: Request, user: AuthUser = Depends(require_user)):
    pool = request.app.state.vctex_pool
    return await vctex_bot_service.stop_bot(pool, user.user_id)


@router.get("/bot/status")
async def bot_status(request: Request, user: AuthUser = Depends(require_user)):
    pool = request.app.state.vctex_pool
    return await vctex_bot_service.get_bot_status(pool, user.user_id)


@router.get("/bot/events")
async def bot_events(user: AuthUser = Depends(require_user)):
    return {"events": [e for e in _events if e.get("user_id") == user.user_id][-100:]}


# ─── Stats ──────────────────────────────────────────────────────────────────

@router.get("/stats/dashboard")
async def stats_dashboard(batch_id: str | None = None, user: AuthUser = Depends(require_user)):
    db = get_db()
    rows: list[dict] = []
    PAGE = 1000
    offset = 0
    while offset < MAX_ROWS:
        q = scoped(db, "vctex_leads", user.user_id).select(
            "status,valor_liberado,batch_id"
        )
        if batch_id is not None:
            q = q.eq("batch_id", batch_id)
        chunk = q.range(offset, offset + PAGE - 1).execute().data or []
        rows.extend(chunk)
        if len(chunk) < PAGE:
            break
        offset += PAGE

    counts: dict[str, int] = {}
    total_liberado = 0.0
    for r in rows:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
        if r["status"] == "elegivel":
            total_liberado += float(r.get("valor_liberado") or 0)
    eleg = counts.get("elegivel", 0)
    ineleg = counts.get("inelegivel", 0)
    erros = counts.get("erro", 0)
    pend = counts.get("pendente", 0)
    em_proc = counts.get("fase0", 0) + counts.get("fase1", 0) + counts.get("fase2", 0)
    return {
        "total": len(rows),
        "elegiveis": eleg,
        "inelegiveis": ineleg,
        "pendentes": pend,
        "erros": erros,
        "em_processamento": em_proc,
        "aguardando_autorizacao": 0,
        "processados": eleg + ineleg + erros,
        "total_liberado": round(total_liberado, 2),
        "total_margem": 0.0,
        "by_status": counts,
    }


# ─── Batches ────────────────────────────────────────────────────────────────

@router.get("/batches/")
def list_batches(user: AuthUser = Depends(require_user)):
    db = get_db()
    rows = (
        scoped(db, "vctex_batches", user.user_id)
        .select("*").order("created_at", desc=True).execute().data or []
    )
    return {"data": rows}


@router.get("/batches/stats/{batch_id}")
@router.get("/batches/{batch_id}/stats")
def batch_stats(batch_id: str, user: AuthUser = Depends(require_user)):
    db = get_db()
    own = (
        scoped(db, "vctex_batches", user.user_id)
        .select("id").eq("id", batch_id).execute().data or []
    )
    if not own:
        raise HTTPException(404, "Batch não encontrada")
    rows: list[dict] = []
    PAGE = 1000
    offset = 0
    while offset < MAX_ROWS:
        chunk = (
            scoped(db, "vctex_leads", user.user_id)
            .select("status,valor_liberado")
            .eq("batch_id", batch_id)
            .range(offset, offset + PAGE - 1)
            .execute().data or []
        )
        rows.extend(chunk)
        if len(chunk) < PAGE:
            break
        offset += PAGE
    counts: dict[str, int] = {}
    total_liberado = 0.0
    for r in rows:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
        if r["status"] == "elegivel":
            total_liberado += float(r.get("valor_liberado") or 0)
    eleg = counts.get("elegivel", 0)
    ineleg = counts.get("inelegivel", 0)
    erros = counts.get("erro", 0)
    return {
        "total": len(rows), "elegiveis": eleg, "inelegiveis": ineleg,
        "pendentes": counts.get("pendente", 0), "erros": erros,
        "em_processamento": counts.get("fase0", 0) + counts.get("fase1", 0) + counts.get("fase2", 0),
        "aguardando_autorizacao": 0, "processados": eleg + ineleg + erros,
        "total_liberado": round(total_liberado, 2), "total_margem": 0.0, "by_status": counts,
    }


@router.get("/batches/current")
def current_batch(user: AuthUser = Depends(require_user)):
    db = get_db()
    active = (
        scoped(db, "vctex_batches", user.user_id).select("*")
        .in_("status", ["pendente", "processando"])
        .order("created_at", desc=True).limit(1).execute().data or []
    )
    if active:
        return active[0]
    latest = (
        scoped(db, "vctex_batches", user.user_id).select("*")
        .order("created_at", desc=True).limit(1).execute().data or []
    )
    return latest[0] if latest else None


@router.get("/batches/{batch_id}")
def get_batch(batch_id: str, user: AuthUser = Depends(require_user)):
    db = get_db()
    rows = (
        scoped(db, "vctex_batches", user.user_id).select("*")
        .eq("id", batch_id).execute().data or []
    )
    if not rows:
        raise HTTPException(404, "Batch não encontrada")
    return rows[0]


class PatchBatchBody(BaseModel):
    name: str | None = None
    status: str | None = None


@router.patch("/batches/{batch_id}")
def patch_batch(batch_id: str, body: PatchBatchBody, user: AuthUser = Depends(require_user)):
    db = get_db()
    payload: dict = {}
    if body.name is not None:
        payload["name"] = body.name.strip()[:120]
    if body.status is not None:
        if body.status not in ("pendente", "processando", "concluida", "cancelada"):
            raise HTTPException(400, "status inválido")
        payload["status"] = body.status
    if not payload:
        raise HTTPException(400, "Nada para atualizar")
    rows = (
        scoped(db, "vctex_batches", user.user_id)
        .update(payload).eq("id", batch_id).execute().data or []
    )
    if not rows:
        raise HTTPException(404, "Batch não encontrada")
    return rows[0]


@router.delete("/batches/{batch_id}", status_code=204)
def delete_batch(batch_id: str, user: AuthUser = Depends(require_user)):
    db = get_db()
    own = (
        scoped(db, "vctex_batches", user.user_id)
        .select("id").eq("id", batch_id).execute().data or []
    )
    if not own:
        raise HTTPException(404, "Batch não encontrada")
    scoped(db, "vctex_leads", user.user_id).delete().eq("batch_id", batch_id).execute()
    scoped(db, "vctex_batches", user.user_id).delete().eq("id", batch_id).execute()


@router.post("/leads/retry-errors")
def retry_errors(batch_id: str | None = None, user: AuthUser = Depends(require_user)):
    db = get_db()
    q = scoped(db, "vctex_leads", user.user_id).update({"status": "pendente", "erro": None}).eq("status", "erro")
    if batch_id:
        q = q.eq("batch_id", batch_id)
    result = q.execute()
    return {"resetados": len(result.data or [])}


@router.get("/bot/runs")
def list_runs(limit: int = 20, user: AuthUser = Depends(require_user)):
    db = get_db()
    rows = (
        scoped(db, "vctex_bot_runs", user.user_id)
        .select("id,started_at,finished_at,status,num_workers,total_processed,total_elegiveis,total_inelegiveis")
        .order("started_at", desc=True)
        .limit(min(limit, 100))
        .execute().data or []
    )
    return {"runs": rows}
