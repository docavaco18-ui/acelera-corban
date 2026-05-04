"""CRM — Acompanhamento de Propostas (/api/crm/*)."""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, condecimal
from datetime import date
from typing import Optional
from decimal import Decimal

from ..auth_deps import require_user, AuthUser
from ..database import db as get_db
from ..db_scoped import scoped

router = APIRouter(prefix="/api/crm", tags=["crm"])

VALID_STATUS = {"propostas", "importante", "pendentes", "leilao", "fgts"}
VALID_BANCOS = {
    "V8", "Zilli", "Novo Saque", "VCTex", "Pan",
    "Facta", "C6", "Mercantil", "2S", "Soma",
}


class PropostaBody(BaseModel):
    nome_vendedor: str
    banco: str
    cliente_cpf: str
    data_venda: date
    valor: float
    prazo: int
    parcela: float
    codigo_proposta: str = ""
    status: str = "propostas"


class PatchPropostaBody(BaseModel):
    nome_vendedor: Optional[str] = None
    banco: Optional[str] = None
    cliente_cpf: Optional[str] = None
    data_venda: Optional[date] = None
    valor: Optional[float] = None
    prazo: Optional[int] = None
    parcela: Optional[float] = None
    codigo_proposta: Optional[str] = None
    status: Optional[str] = None


@router.get("/propostas")
def list_propostas(
    status: str | None = None,
    banco: str | None = None,
    data_inicio: date | None = None,
    data_fim: date | None = None,
    user: AuthUser = Depends(require_user),
):
    db = get_db()
    q = scoped(db, "crm_propostas", user.user_id).select("*").order("created_at", desc=True)
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
    payload = {
        "nome_vendedor": body.nome_vendedor.strip(),
        "banco": body.banco.strip(),
        "cliente_cpf": body.cliente_cpf.strip().replace(".", "").replace("-", ""),
        "data_venda": str(body.data_venda),
        "valor": float(body.valor),
        "prazo": body.prazo,
        "parcela": float(body.parcela),
        "codigo_proposta": body.codigo_proposta.strip(),
        "status": body.status,
    }
    db = get_db()
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
def delete_proposta(proposta_id: str, user: AuthUser = Depends(require_user)):
    db = get_db()
    own = (
        scoped(db, "crm_propostas", user.user_id)
        .select("id").eq("id", proposta_id).execute().data or []
    )
    if not own:
        raise HTTPException(404, "Proposta não encontrada")
    scoped(db, "crm_propostas", user.user_id).delete().eq("id", proposta_id).execute()


@router.get("/propostas/stats")
def propostas_stats(user: AuthUser = Depends(require_user)):
    """Resumo por status e banco para sidebar/gráficos."""
    db = get_db()
    rows = (
        scoped(db, "crm_propostas", user.user_id)
        .select("status,banco,valor,nome_vendedor")
        .execute().data or []
    )
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

    return {
        "total": total,
        "total_valor": round(total_valor, 2),
        "ticket_medio": ticket_medio,
        "by_status": by_status,
        "by_banco": by_banco,
        "ranking": ranking,
    }
