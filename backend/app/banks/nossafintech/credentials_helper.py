from typing import Any
from fastapi import HTTPException
from ...credentials.service import CredentialService, BankCredentials


def get_nossafintech_runtime_creds(user_id: str, db: Any) -> BankCredentials:
    creds = CredentialService(db).get(user_id, "nossafintech")
    if creds is None or not creds.login or not creds.password:
        raise HTTPException(
            status_code=400,
            detail="Credenciais Nossa Fintech não cadastradas. Cadastre CPF, ID da promotora e senha em Configurações.",
        )
    if not (creds.extra or {}).get("promot_id"):
        raise HTTPException(
            status_code=400,
            detail="ID da promotora (promot_id) não cadastrado. Preencha em Configurações → Nossa Fintech.",
        )
    return creds
