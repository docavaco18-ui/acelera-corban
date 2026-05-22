from typing import Any
from fastapi import HTTPException
from ...credentials.service import CredentialService, BankCredentials


def get_powerhub_runtime_creds(user_id: str, db: Any) -> BankCredentials:
    creds = CredentialService(db).get(user_id, "powerhub")
    if creds is None or not creds.login or not creds.password:
        raise HTTPException(
            status_code=400,
            detail="Credenciais PowerHub não cadastradas. Cadastre em Configurações antes de usar.",
        )
    return creds
