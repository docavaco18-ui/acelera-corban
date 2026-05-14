from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from ..database import get_db
from ..auth_deps import require_user, AuthUser
from .service import CredentialService


BankCode = Literal["v8", "vctex", "mercantil"]
ALLOWED_BANKS: tuple[str, ...] = ("v8", "vctex", "mercantil")

router = APIRouter(prefix="/api/credentials", tags=["credentials"])


def get_credential_service() -> CredentialService:
    return CredentialService(get_db())


class CredentialPayload(BaseModel):
    login: str = Field(..., min_length=1)
    password: str | None = Field(default=None)
    proxies: list[str] = Field(default_factory=list)


class BankSummary(BaseModel):
    configured: bool
    login: str | None
    has_password: bool
    proxies: list[str]


@router.get("")
def list_credentials(
    user: AuthUser = Depends(require_user),
    svc: CredentialService = Depends(get_credential_service),
) -> dict[str, BankSummary | None]:
    out: dict[str, BankSummary | None] = {}
    for bank in ALLOWED_BANKS:
        creds = svc.get(user.user_id, bank)
        if creds is None:
            out[bank] = None
        else:
            out[bank] = BankSummary(
                configured=True,
                login=creds.login,
                has_password=bool(creds.password),
                proxies=creds.proxies or [],
            )
    return out


@router.put("/{bank_code}", status_code=status.HTTP_204_NO_CONTENT)
def upsert_credentials(
    bank_code: str,
    payload: CredentialPayload,
    user: AuthUser = Depends(require_user),
    svc: CredentialService = Depends(get_credential_service),
):
    if bank_code not in ALLOWED_BANKS:
        raise HTTPException(400, f"bank_code inválido. Aceitos: {ALLOWED_BANKS}")
    existing = svc.get(user.user_id, bank_code)
    if existing is None and not payload.password:
        raise HTTPException(400, "Senha obrigatória no primeiro cadastro")
    svc.upsert(
        user_id=user.user_id,
        bank_code=bank_code,
        login=payload.login,
        password=payload.password or None,
        proxies=payload.proxies,
    )
