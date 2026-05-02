from typing import Any
from fastapi import HTTPException
from ...credentials.service import CredentialService, BankCredentials


def get_vctex_runtime_creds(user_id: str, db: Any) -> BankCredentials:
    """Busca credenciais VCTex do user. Levanta 400 se não houver login+password.

    Sem fallback pro .env: regra de produto é estrita.
    """
    creds = CredentialService(db).get(user_id, "vctex")
    if creds is None or not creds.login or not creds.password:
        raise HTTPException(
            status_code=400,
            detail="credenciais VCTex não cadastradas. Cadastre em /api/credentials/vctex antes de usar.",
        )
    return creds
