from fastapi import APIRouter, Depends
from ..database import db
from ..auth_deps import require_user, AuthUser

router = APIRouter(prefix="/api/stats", tags=["stats"])

PAGE = 1000


def _scan_all(columns: str, owner_id: str | None) -> list[dict]:
    """Scaneia v8_leads paginado. Se owner_id != None, filtra; senão (admin) traz tudo."""
    rows: list[dict] = []
    offset = 0
    while True:
        q = db().table("v8_leads").select(columns)
        if owner_id is not None:
            q = q.eq("owner_id", owner_id)
        chunk = q.range(offset, offset + PAGE - 1).execute().data or []
        rows.extend(chunk)
        if len(chunk) < PAGE:
            break
        offset += PAGE
    return rows


def _summarize(rows: list[dict]) -> dict:
    counts: dict[str, int] = {}
    total_liberado = 0.0
    total_margem = 0.0
    for r in rows:
        counts[r["status"]] = counts.get(r["status"], 0) + 1
        if r["status"] == "elegivel":
            total_liberado += float(r.get("valor_liberado") or 0)
            total_margem += float(r.get("margem_disponivel") or 0)
    eleg = counts.get("elegivel", 0)
    ineleg = counts.get("inelegivel", 0)
    erros = counts.get("erro", 0)
    pend = counts.get("pendente", 0)
    em_proc = counts.get("consentido", 0) + counts.get("autorizado", 0) + counts.get("enriquecido", 0)
    aguard = counts.get("aguardando_resultado", 0)
    return {
        "total": len(rows),
        "elegiveis": eleg,
        "inelegiveis": ineleg,
        "pendentes": pend,
        "erros": erros,
        "em_processamento": em_proc,
        "aguardando_autorizacao": aguard,
        "processados": eleg + ineleg + erros,
        "total_liberado": round(total_liberado, 2),
        "total_margem": round(total_margem, 2),
        "by_status": counts,
    }


@router.get("/dashboard")
async def dashboard(user: AuthUser = Depends(require_user)):
    owner_id = None if user.is_admin else user.user_id
    rows = _scan_all("status,valor_liberado,margem_disponivel,created_at,owner_id", owner_id)
    return _summarize(rows)
