"""Resolve credenciais Mercantil do user. Erro 400 se não houver cadastro."""
from typing import Any
from fastapi import HTTPException
from ...credentials.service import CredentialService, BankCredentials


def get_mercantil_runtime_creds(user_id: str, db: Any) -> BankCredentials:
    creds = CredentialService(db).get(user_id, "mercantil")
    if creds is None or not creds.login or not creds.password:
        raise HTTPException(
            status_code=400,
            detail="credenciais Mercantil não cadastradas. "
                   "Cadastre em /api/credentials/mercantil antes de usar.",
        )
    return creds
