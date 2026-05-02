from fastapi import APIRouter, Depends, HTTPException
from ..auth_deps import require_user, AuthUser
from ..database import db as get_db
from ..db_scoped import scoped

router = APIRouter(prefix="/api/batches", tags=["batches"])


def _summarize_leads(rows: list[dict]) -> dict:
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


@router.get("/")
def list_batches(user: AuthUser = Depends(require_user)):
    db = get_db()
    rows = (
        scoped(db, "v8_batches", user.user_id)
        .select("*")
        .order("created_at", desc=True)
        .execute().data or []
    )
    return {"data": rows}


@router.get("/current")
def current_batch(user: AuthUser = Depends(require_user)):
    """Última batch criada (status pendente/processando preferido; senão a mais recente)."""
    db = get_db()
    # Prioriza ativas (pendente/processando)
    active = (
        scoped(db, "v8_batches", user.user_id)
        .select("*")
        .in_("status", ["pendente", "processando"])
        .order("created_at", desc=True)
        .limit(1)
        .execute().data or []
    )
    if active:
        return active[0]
    # Senão, retorna a mais recente (qualquer status)
    latest = (
        scoped(db, "v8_batches", user.user_id)
        .select("*")
        .order("created_at", desc=True)
        .limit(1)
        .execute().data or []
    )
    return latest[0] if latest else None


@router.get("/{batch_id}")
def get_batch(batch_id: str, user: AuthUser = Depends(require_user)):
    db = get_db()
    rows = (
        scoped(db, "v8_batches", user.user_id)
        .select("*")
        .eq("id", batch_id)
        .execute().data or []
    )
    if not rows:
        raise HTTPException(404, "Batch não encontrada")
    return rows[0]


@router.get("/{batch_id}/stats")
def batch_stats(batch_id: str, user: AuthUser = Depends(require_user)):
    """Stats agregadas dos leads de uma batch específica."""
    db = get_db()
    # Confirma posse da batch
    own = (
        scoped(db, "v8_batches", user.user_id)
        .select("id")
        .eq("id", batch_id)
        .execute().data or []
    )
    if not own:
        raise HTTPException(404, "Batch não encontrada")

    rows: list[dict] = []
    PAGE = 1000
    offset = 0
    while True:
        chunk = (
            scoped(db, "v8_leads", user.user_id)
            .select("status,valor_liberado,margem_disponivel")
            .eq("batch_id", batch_id)
            .range(offset, offset + PAGE - 1)
            .execute().data or []
        )
        rows.extend(chunk)
        if len(chunk) < PAGE:
            break
        offset += PAGE
    return _summarize_leads(rows)
