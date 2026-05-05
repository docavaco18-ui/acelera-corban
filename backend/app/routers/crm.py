"""CRM — Acompanhamento de Propostas (/api/crm/*)."""
import hashlib
import secrets
from datetime import date, datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel

from ..auth_deps import require_user, require_admin, AuthUser
from ..database import db as get_db
from ..db_scoped import scoped

router = APIRouter(prefix="/api/crm", tags=["crm"])

VALID_STATUS = {"propostas", "importante", "pendentes", "leilao", "fgts", "karol", "giovanna", "gabriel"}


# ─── Password helpers ──────────────────────────────────────────────────────────

def _hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.sha256(f"{salt}:{password}".encode()).hexdigest()
    return f"{salt}:{digest}"


def _verify_password(password: str, stored: str) -> bool:
    if not stored:
        return False
    parts = stored.split(":", 1)
    if len(parts) != 2:
        return False
    salt, expected = parts
    digest = hashlib.sha256(f"{salt}:{password}".encode()).hexdigest()
    return secrets.compare_digest(digest, expected)


def _get_crm_password_hash(db, user_id: str) -> str | None:
    rows = (
        scoped(db, "crm_settings", user_id)
        .select("crm_password_hash")
        .execute().data or []
    )
    if rows:
        return rows[0].get("crm_password_hash")
    return None


def _check_crm_password(db, user_id: str, provided: str | None):
    """Levanta 403 se senha CRM está ativa e provided não bate."""
    stored = _get_crm_password_hash(db, user_id)
    if stored:
        if not provided:
            raise HTTPException(403, "Senha CRM obrigatória para esta ação")
        if not _verify_password(provided, stored):
            raise HTTPException(403, "Senha CRM incorreta")


# ─── Schemas ──────────────────────────────────────────────────────────────────

class PropostaBody(BaseModel):
    nome_vendedor: str
    banco: str
    cliente_cpf: str
    cliente_nome: str = ""
    data_venda: date
    valor: float
    prazo: int
    parcela: float
    codigo_proposta: str = ""
    status: str = "propostas"
    crm_password: Optional[str] = None


class PatchPropostaBody(BaseModel):
    nome_vendedor: Optional[str] = None
    banco: Optional[str] = None
    cliente_cpf: Optional[str] = None
    cliente_nome: Optional[str] = None
    data_venda: Optional[date] = None
    valor: Optional[float] = None
    prazo: Optional[int] = None
    parcela: Optional[float] = None
    codigo_proposta: Optional[str] = None
    status: Optional[str] = None


class DeleteBody(BaseModel):
    crm_password: Optional[str] = None


class CrmPasswordBody(BaseModel):
    password: str


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/propostas")
def list_propostas(
    status: str | None = None,
    banco: str | None = None,
    data_inicio: date | None = None,
    data_fim: date | None = None,
    pending_only: bool = False,
    user: AuthUser = Depends(require_user),
):
    db = get_db()
    q = scoped(db, "crm_propostas", user.user_id).select("*").order("created_at", desc=True)

    if pending_only and user.is_admin:
        q = q.eq("approved", False)
    elif not user.is_admin:
        # Non-admin só vê aprovadas
        q = q.eq("approved", True)

    if status and status in VALID_STATUS:
        q = q.eq("status", status)
    if banco:
        q = q.eq("banco", banco)
    if data_inicio:
        q = q.gte("data_venda", str(data_inicio))
    if data_fim:
        q = q.lte("data_venda", str(data_fim))

    rows = q.execute().data or []
    return {"data": rows}


@router.post("/propostas", status_code=201)
def create_proposta(body: PropostaBody, user: AuthUser = Depends(require_user)):
    if body.status not in VALID_STATUS:
        raise HTTPException(400, f"status inválido: {body.status}")

    db = get_db()
    _check_crm_password(db, user.user_id, body.crm_password)

    payload = {
        "nome_vendedor": body.nome_vendedor.strip(),
        "banco": body.banco.strip(),
        "cliente_cpf": body.cliente_cpf.strip().replace(".", "").replace("-", ""),
        "cliente_nome": body.cliente_nome.strip(),
        "data_venda": str(body.data_venda),
        "valor": float(body.valor),
        "prazo": body.prazo,
        "parcela": float(body.parcela),
        "codigo_proposta": body.codigo_proposta.strip(),
        "status": body.status,
        "approved": user.is_admin,
        "approved_at": datetime.now(timezone.utc).isoformat() if user.is_admin else None,
        "approved_by": user.user_id if user.is_admin else None,
    }
    rows = scoped(db, "crm_propostas", user.user_id).insert(payload).execute().data or []
    if not rows:
        raise HTTPException(500, "Erro ao criar proposta")
    return rows[0]


@router.patch("/propostas/{proposta_id}")
def patch_proposta(
    proposta_id: str,
    body: PatchPropostaBody,
    user: AuthUser = Depends(require_user),
):
    db = get_db()
    own = (
        scoped(db, "crm_propostas", user.user_id)
        .select("id").eq("id", proposta_id).execute().data or []
    )
    if not own:
        raise HTTPException(404, "Proposta não encontrada")

    payload: dict = {}
    if body.nome_vendedor is not None:
        payload["nome_vendedor"] = body.nome_vendedor.strip()
    if body.banco is not None:
        payload["banco"] = body.banco.strip()
    if body.cliente_cpf is not None:
        payload["cliente_cpf"] = body.cliente_cpf.strip().replace(".", "").replace("-", "")
    if body.cliente_nome is not None:
        payload["cliente_nome"] = body.cliente_nome.strip()
    if body.data_venda is not None:
        payload["data_venda"] = str(body.data_venda)
    if body.valor is not None:
        payload["valor"] = float(body.valor)
    if body.prazo is not None:
        payload["prazo"] = body.prazo
    if body.parcela is not None:
        payload["parcela"] = float(body.parcela)
    if body.codigo_proposta is not None:
        payload["codigo_proposta"] = body.codigo_proposta.strip()
    if body.status is not None:
        if body.status not in VALID_STATUS:
            raise HTTPException(400, f"status inválido: {body.status}")
        payload["status"] = body.status

    if not payload:
        raise HTTPException(400, "Nada para atualizar")

    rows = (
        scoped(db, "crm_propostas", user.user_id)
        .update(payload).eq("id", proposta_id).execute().data or []
    )
    if not rows:
        raise HTTPException(404, "Proposta não encontrada")
    return rows[0]


@router.delete("/propostas/{proposta_id}", status_code=204)
def delete_proposta(
    proposta_id: str,
    body: DeleteBody = DeleteBody(),
    user: AuthUser = Depends(require_user),
):
    if not user.is_admin:
        raise HTTPException(403, "Apenas administradores podem apagar propostas")

    db = get_db()
    _check_crm_password(db, user.user_id, body.crm_password)

    own = (
        scoped(db, "crm_propostas", user.user_id)
        .select("id").eq("id", proposta_id).execute().data or []
    )
    if not own:
        raise HTTPException(404, "Proposta não encontrada")

    scoped(db, "crm_propostas", user.user_id).delete().eq("id", proposta_id).execute()


@router.post("/propostas/{proposta_id}/approve")
def approve_proposta(
    proposta_id: str,
    user: AuthUser = Depends(require_admin),
):
    db = get_db()
    own = (
        scoped(db, "crm_propostas", user.user_id)
        .select("id,approved").eq("id", proposta_id).execute().data or []
    )
    if not own:
        raise HTTPException(404, "Proposta não encontrada")

    rows = (
        scoped(db, "crm_propostas", user.user_id)
        .update({
            "approved": True,
            "approved_at": datetime.now(timezone.utc).isoformat(),
            "approved_by": user.user_id,
        })
        .eq("id", proposta_id)
        .execute().data or []
    )
    if not rows:
        raise HTTPException(500, "Erro ao aprovar")
    return rows[0]


@router.get("/settings")
def get_crm_settings(user: AuthUser = Depends(require_user)):
    db = get_db()
    stored = _get_crm_password_hash(db, user.user_id)
    return {"has_crm_password": bool(stored)}


@router.put("/settings/password")
def set_crm_password(body: CrmPasswordBody, user: AuthUser = Depends(require_admin)):
    if len(body.password) < 4:
        raise HTTPException(400, "Senha deve ter ao menos 4 caracteres")
    db = get_db()
    hashed = _hash_password(body.password)
    now = datetime.now(timezone.utc).isoformat()
    scoped(db, "crm_settings", user.user_id).upsert(
        {"crm_password_hash": hashed, "updated_at": now},
        on_conflict="owner_id",
    ).execute()
    return {"ok": True}


@router.delete("/settings/password", status_code=204)
def remove_crm_password(user: AuthUser = Depends(require_admin)):
    db = get_db()
    scoped(db, "crm_settings", user.user_id).upsert(
        {"crm_password_hash": None, "updated_at": datetime.now(timezone.utc).isoformat()},
        on_conflict="owner_id",
    ).execute()


@router.get("/propostas/stats")
def propostas_stats(user: AuthUser = Depends(require_user)):
    db = get_db()
    q = scoped(db, "crm_propostas", user.user_id).select("status,banco,valor,nome_vendedor,approved")
    if not user.is_admin:
        q = q.eq("approved", True)
    rows = q.execute().data or []

    by_status: dict[str, int] = {}
    by_banco: dict[str, int] = {}
    by_vendedor: dict[str, float] = {}
    total_valor = 0.0

    for r in rows:
        s = r.get("status", "propostas")
        b = r.get("banco", "—")
        v = r.get("nome_vendedor", "—")
        val = float(r.get("valor") or 0)

        by_status[s] = by_status.get(s, 0) + 1
        by_banco[b] = by_banco.get(b, 0) + 1
        by_vendedor[v] = by_vendedor.get(v, 0.0) + val
        total_valor += val

    total = len(rows)
    ticket_medio = round(total_valor / total, 2) if total else 0.0

    ranking = sorted(
        [{"nome": k, "total": round(v, 2)} for k, v in by_vendedor.items()],
        key=lambda x: x["total"], reverse=True,
    )[:10]

    pending_count = 0
    if user.is_admin:
        pending_rows = (
            scoped(db, "crm_propostas", user.user_id)
            .select("id").eq("approved", False).execute().data or []
        )
        pending_count = len(pending_rows)

    return {
        "total": total,
        "total_valor": round(total_valor, 2),
        "ticket_medio": ticket_medio,
        "by_status": by_status,
        "by_banco": by_banco,
        "ranking": ranking,
        "pending_count": pending_count,
    }
