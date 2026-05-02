import json
from dataclasses import dataclass, field
from typing import Any
from .crypto import encrypt, decrypt


@dataclass
class BankCredentials:
    user_id: str
    bank_code: str
    login: str | None = None
    password: str | None = None
    extra: dict = field(default_factory=dict)
    proxies: list[str] = field(default_factory=list)


class CredentialService:
    TABLE = "user_bank_credentials"

    def __init__(self, db: Any):
        self.db = db

    def get(self, user_id: str, bank_code: str) -> BankCredentials | None:
        resp = (
            self.db.table(self.TABLE)
            .select("*")
            .eq("user_id", user_id)
            .eq("bank_code", bank_code)
            .execute()
        )
        rows = resp.data or []
        if not rows:
            return None
        row = rows[0]
        return BankCredentials(
            user_id=user_id,
            bank_code=bank_code,
            login=decrypt(row.get("login_enc")),
            password=decrypt(row.get("password_enc")),
            extra=json.loads(decrypt(row.get("extra_enc")) or "{}") if row.get("extra_enc") else {},
            proxies=json.loads(decrypt(row.get("proxies_enc")) or "[]") if row.get("proxies_enc") else [],
        )

    def upsert(
        self,
        user_id: str,
        bank_code: str,
        login: str | None = None,
        password: str | None = None,
        extra: dict | None = None,
        proxies: list[str] | None = None,
    ) -> None:
        payload = {
            "user_id": user_id,
            "bank_code": bank_code,
            "login_enc": encrypt(login),
            "password_enc": encrypt(password),
            "extra_enc": encrypt(json.dumps(extra)) if extra else None,
            "proxies_enc": encrypt(json.dumps(proxies)) if proxies else None,
        }
        self.db.table(self.TABLE).upsert(
            payload, on_conflict="user_id,bank_code"
        ).execute()
