from typing import Any
from fastapi import HTTPException
from ...credentials.service import CredentialService, BankCredentials


def get_v8_runtime_creds(user_id: str, db: Any) -> BankCredentials:
    """Busca credenciais V8 do user. Levanta 400 se não houver login+password.

    Sem fallback pro .env: regra de produto é estrita.
    """
    creds = CredentialService(db).get(user_id, "v8")
    if creds is None or not creds.login or not creds.password:
        raise HTTPException(
            status_code=400,
            detail="credenciais V8 não cadastradas. Cadastre em /api/credentials/v8 antes de usar.",
        )
    return creds
