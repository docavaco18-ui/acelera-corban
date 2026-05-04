import csv
import io
from fastapi import APIRouter, UploadFile, File, HTTPException, Depends
from fastapi.responses import StreamingResponse
from ..auth_deps import require_user, AuthUser
from ..database import db as get_db
from ..db_scoped import scoped
from ..services import upload_jobs

router = APIRouter(prefix="/api/leads", tags=["leads"])


@router.post("/upload", status_code=202)
async def upload_csv(
    file: UploadFile = File(...),
    user: AuthUser = Depends(require_user),
):
    content = await file.read()
    if not content:
        raise HTTPException(400, "Arquivo vazio")
    result = await upload_jobs.start_upload(content, user.user_id, file_name=file.filename)
    return result


@router.get("/upload/{job_id}")
async def upload_status(
    job_id: str,
    _: AuthUser = Depends(require_user),
):
    state = await upload_jobs.get_job(job_id)
    if state is None:
        raise HTTPException(404, "Job não encontrado ou expirado")
    return state


@router.get("/")
async def list_leads(
    status: str = None,
    erro_contains: str = None,
    batch_id: str | None = None,
    page: int = 1,
    limit: int = 50,
    user: AuthUser = Depends(require_user),
):
    db = get_db()
    q = scoped(db, "v8_leads", user.user_id).select("*").order("created_at", desc=True)
    if status:
        q = q.eq("status", status)
    if batch_id:
        q = q.eq("batch_id", batch_id)
    if erro_contains:
        q = q.ilike("erro", f"*{erro_contains}*")
    result = q.range((page - 1) * limit, page * limit - 1).execute()
    return {"data": result.data, "page": page}


@router.get("/export")
async def export_csv(
    status: str = "elegivel",
    user: AuthUser = Depends(require_user),
):
    db = get_db()
    result = scoped(db, "v8_leads", user.user_id).select("*").eq("status", status).execute()
    leads = result.data

    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=[
        "cpf", "nome", "telefone", "status", "margem_disponivel",
        "valor_liberado", "valor_parcela", "num_parcelas", "cet_mensal", "erro"
    ])
    writer.writeheader()
    for lead in leads:
        writer.writerow({k: lead.get(k, "") for k in writer.fieldnames})

    output.seek(0)
    return StreamingResponse(
        io.BytesIO(output.getvalue().encode()),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={status}_v8.csv"},
    )


@router.delete("/reset")
async def reset_leads(user: AuthUser = Depends(require_user)):
    """Apaga apenas os leads do dono."""
    db = get_db()
    scoped(db, "v8_leads", user.user_id).delete().neq("id", "00000000-0000-0000-0000-000000000000").execute()
    return {"status": "reset"}


@router.post("/retry-errors")
async def retry_errors(batch_id: str | None = None, user: AuthUser = Depends(require_user)):
    """Reseta leads com status 'erro' → 'pendente' pra o bot reprocessar."""
    db = get_db()
    q = scoped(db, "v8_leads", user.user_id).update({"status": "pendente", "erro_detalhe": None}).eq("status", "erro")
    if batch_id:
        q = q.eq("batch_id", batch_id)
    result = q.execute()
    count = len(result.data or [])
    return {"resetados": count}
