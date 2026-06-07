import json
from dataclasses import dataclass, field
from typing import Any
from .crypto import encrypt, decrypt, safe_decrypt


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
            login=safe_decrypt(row.get("login_enc")),
            password=safe_decrypt(row.get("password_enc")),
            extra=json.loads(safe_decrypt(row.get("extra_enc")) or "{}") if row.get("extra_enc") else {},
            proxies=json.loads(safe_decrypt(row.get("proxies_enc")) or "[]") if row.get("proxies_enc") else [],
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
        existing = self.get(user_id, bank_code)
        payload: dict = {"user_id": user_id, "bank_code": bank_code}
        if login is not None:
            payload["login_enc"] = encrypt(login)
        if password is not None:
            payload["password_enc"] = encrypt(password)
        elif existing is None:
            payload["password_enc"] = None
        if extra is not None:
            payload["extra_enc"] = encrypt(json.dumps(extra))
        if proxies is not None:
            payload["proxies_enc"] = encrypt(json.dumps(proxies))
        self.db.table(self.TABLE).upsert(
            payload, on_conflict="user_id,bank_code"
        ).execute()
