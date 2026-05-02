from fastapi import APIRouter, Depends
from ..auth_deps import require_user, AuthUser
from ..database import db as get_db
from ..db_scoped import scoped

router = APIRouter(prefix="/api/stats", tags=["stats"])

PAGE = 1000


def _scan_all(db, user_id: str, columns: str, batch_id: str | None = None) -> list[dict]:
    """Scaneia v8_leads do user paginado, opcionalmente filtrado por batch."""
    rows: list[dict] = []
    offset = 0
    while True:
        q = scoped(db, "v8_leads", user_id).select(columns)
        if batch_id is not None:
            q = q.eq("batch_id", batch_id)
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
async def dashboard(batch_id: str | None = None, user: AuthUser = Depends(require_user)):
    db = get_db()
    rows = _scan_all(db, user.user_id, "status,valor_liberado,margem_disponivel,created_at,owner_id,batch_id", batch_id=batch_id)
    return _summarize(rows)
