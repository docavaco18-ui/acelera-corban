from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
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
    batches = (
        scoped(db, "v8_batches", user.user_id)
        .select("*")
        .order("created_at", desc=True)
        .execute().data or []
    )
    if not batches:
        return {"data": []}

    # Compute live stats for all batches — paginated (Supabase default cap = 1000 rows)
    batch_ids = [b["id"] for b in batches]
    PAGE = 1000
    leads: list[dict] = []
    offset = 0
    while offset < MAX_ROWS:
        chunk = (
            scoped(db, "v8_leads", user.user_id)
            .select("batch_id,status,valor_liberado")
            .in_("batch_id", batch_ids)
            .range(offset, offset + PAGE - 1)
            .execute().data or []
        )
        leads.extend(chunk)
        if len(chunk) < PAGE:
            break
        offset += PAGE

    agg: dict[str, dict] = {}
    for lead in leads:
        bid = lead.get("batch_id")
        if not bid:
            continue
        if bid not in agg:
            agg[bid] = {"total_processed": 0, "total_elegiveis": 0, "total_liberado": 0.0}
        if lead["status"] in ("elegivel", "inelegivel", "erro"):
            agg[bid]["total_processed"] += 1
        if lead["status"] == "elegivel":
            agg[bid]["total_elegiveis"] += 1
            agg[bid]["total_liberado"] += float(lead.get("valor_liberado") or 0)

    for b in batches:
        s = agg.get(b["id"], {})
        b["total_processed"] = s.get("total_processed", b.get("total_processed") or 0)
        b["total_elegiveis"] = s.get("total_elegiveis", b.get("total_elegiveis") or 0)
        b["total_liberado"] = round(s.get("total_liberado", float(b.get("total_liberado") or 0)), 2)

    return {"data": batches}


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
    while offset < MAX_ROWS:
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


class PatchBatchBody(BaseModel):
    name: str | None = None
    status: str | None = None


@router.patch("/{batch_id}")
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
        scoped(db, "v8_batches", user.user_id)
        .update(payload)
        .eq("id", batch_id)
        .execute().data or []
    )
    if not rows:
        raise HTTPException(404, "Batch não encontrada")
    return rows[0]


@router.delete("/{batch_id}", status_code=204)
def delete_batch(batch_id: str, user: AuthUser = Depends(require_user)):
    """Marca batch como cancelada e remove os leads associados."""
    db = get_db()
    own = (
        scoped(db, "v8_batches", user.user_id)
        .select("id")
        .eq("id", batch_id)
        .execute().data or []
    )
    if not own:
        raise HTTPException(404, "Batch não encontrada")
    # Remove leads da batch
    scoped(db, "v8_leads", user.user_id).delete().eq("batch_id", batch_id).execute()
    # Remove a batch
    scoped(db, "v8_batches", user.user_id).delete().eq("id", batch_id).execute()
