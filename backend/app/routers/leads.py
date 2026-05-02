import csv
import io
from fastapi import APIRouter, UploadFile, File, HTTPException, Depends
from fastapi.responses import StreamingResponse
from ..database import db
from ..auth_deps import require_user, AuthUser
from ..services import upload_jobs

router = APIRouter(prefix="/api/leads", tags=["leads"])


def _scope(query, user: AuthUser):
    """Aplica filtro por owner_id quando o usuário não é admin."""
    if not user.is_admin:
        query = query.eq("owner_id", user.user_id)
    return query


@router.post("/upload", status_code=202)
async def upload_csv(
    file: UploadFile = File(...),
    user: AuthUser = Depends(require_user),
):
    content = await file.read()
    if not content:
        raise HTTPException(400, "Arquivo vazio")
    job_id = await upload_jobs.start_upload(content, user.user_id)
    return {"job_id": job_id}


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
    page: int = 1,
    limit: int = 50,
    user: AuthUser = Depends(require_user),
):
    query = db().table("v8_leads").select("*").order("created_at", desc=True)
    query = _scope(query, user)
    if status:
        query = query.eq("status", status)
    if erro_contains:
        query = query.ilike("erro", f"*{erro_contains}*")
    result = query.range((page - 1) * limit, page * limit - 1).execute()
    return {"data": result.data, "page": page}


@router.get("/export")
async def export_csv(
    status: str = "elegivel",
    user: AuthUser = Depends(require_user),
):
    query = db().table("v8_leads").select("*").eq("status", status)
    query = _scope(query, user)
    result = query.execute()
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
    """Apaga apenas os leads do dono (ou todos, se admin pediu)."""
    query = db().table("v8_leads").delete()
    query = _scope(query, user)
    # Quando admin sem filtro, ainda exigimos uma cláusula — usa neq para varrer tudo
    if user.is_admin:
        query = query.neq("id", "00000000-0000-0000-0000-000000000000")
    query.execute()
    return {"status": "reset"}
