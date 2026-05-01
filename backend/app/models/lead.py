from pydantic import BaseModel
from typing import Optional
from datetime import datetime
from uuid import UUID

class LeadRecord(BaseModel):
    id: Optional[UUID] = None
    cpf: str
    telefone: Optional[str] = None
    nome: Optional[str] = None
    email: Optional[str] = None
    data_nascimento: Optional[str] = None
    status: str = "pendente"
    consult_id: Optional[UUID] = None
    margem_disponivel: Optional[float] = None
    valor_liberado: Optional[float] = None
    valor_parcela: Optional[float] = None
    num_parcelas: Optional[int] = None
    cet_mensal: Optional[float] = None
    erro: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

class StatsResponse(BaseModel):
    total: int
    elegiveis: int
    inelegiveis: int
    pendentes: int
    erros: int
    em_processamento: int

class BotEvent(BaseModel):
    type: str
    worker_id: int
    cpf: Optional[str] = None
    status: Optional[str] = None
    message: Optional[str] = None
    ts: Optional[str] = None
