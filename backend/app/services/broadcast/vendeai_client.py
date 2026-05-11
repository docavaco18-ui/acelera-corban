from __future__ import annotations

import asyncio
import time
from typing import Optional

import httpx

BASE_URL = "https://bff.vendeaitecnologia.com.br"


class VendeAIClient:
    def __init__(
        self,
        email: str,
        password: str,
        account_id: Optional[str] = None,
        crm_token: Optional[str] = None,
    ):
        self.email = email
        self.password = password
        self._account_id = account_id
        self._crm_token = crm_token
        self._token: Optional[str] = None
        self._token_expires: float = 0.0
        self._lock = asyncio.Lock()

    async def _ensure_token(self) -> str:
        async with self._lock:
            if self._token and time.time() < self._token_expires:
                return self._token
            async with httpx.AsyncClient() as client:
                r = await client.post(
                    f"{BASE_URL}/api/bff/auth/token/",
                    json={"email": self.email, "password": self.password},
                    timeout=15,
                )
                r.raise_for_status()
                data = r.json()
                token = data.get("access") or data.get("token") or data.get("access_token")
                if not token:
                    raise ValueError(f"Token not found in response: {data}")
                self._token = token
                self._token_expires = time.time() + 3600  # 1h conservative TTL
                return token

    def _headers(self, token: str) -> dict:
        return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    async def list_inboxes(self) -> list[dict]:
        """Returns list of WhatsApp inboxes with phone_number field."""
        async with httpx.AsyncClient() as client:
            # IA API: uses account_id + crm_token directly (confirmed working)
            if self._account_id and self._crm_token:
                try:
                    r = await client.post(
                        "https://ia.vendeaitecnologia.com.br/api/message-handler/mailing/inboxes/",
                        json={
                            "account_id": self._account_id,
                            "crm_api_access_token": self._crm_token,
                        },
                        timeout=15,
                    )
                    r.raise_for_status()
                    data = r.json()
                    inboxes = data.get("inboxes") or (data if isinstance(data, list) else [])
                    if inboxes:
                        return inboxes
                except Exception:
                    pass

            # Fallback: BFF JWT
            token = await self._ensure_token()
            r = await client.get(
                f"{BASE_URL}/api/bff/broadcast/inboxes/",
                headers=self._headers(token),
                timeout=15,
            )
            r.raise_for_status()
            data = r.json()
            if isinstance(data, list):
                return data
            return data.get("inboxes") or data.get("results") or []

    async def list_mailings(self, page: int = 1, page_size: int = 100) -> dict:
        token = await self._ensure_token()
        async with httpx.AsyncClient() as client:
            r = await client.get(
                f"{BASE_URL}/api/bff/broadcast/mailings/",
                headers=self._headers(token),
                params={"mailings": "all", "page": page, "page_size": page_size},
                timeout=15,
            )
            r.raise_for_status()
            return r.json()

    async def get_mailing(self, mailing_id: str) -> Optional[dict]:
        data = await self.list_mailings(page=1, page_size=100)
        for item in data.get("results", []):
            if item.get("id") == mailing_id:
                return item
        return None

    async def dispatch_csv(
        self,
        csv_bytes: bytes,
        csv_filename: str,
        inbox_id: str,
        template_id: str,
        phone_column: str = "telefone",
        campaign_name: str = "",
        cooldown_seconds: int = 5,
        skip_weekends: bool = True,
        skip_night: bool = True,
        dedup_window_hours: int = 24,
        variable_mappings: dict | None = None,
    ) -> dict:
        token = await self._ensure_token()
        headers = {"Authorization": f"Bearer {token}"}
        data: dict = {
            "inbox_id": inbox_id,
            "template_id": template_id,
            "phone_column": phone_column,
            "cooldown_seconds": str(cooldown_seconds),
            "skip_weekends": "true" if skip_weekends else "false",
            "skip_night": "true" if skip_night else "false",
            "dedup_window_hours": str(dedup_window_hours),
        }
        if campaign_name:
            data["campaign_name"] = campaign_name
        if variable_mappings:
            import json
            data["variable_mappings"] = json.dumps(variable_mappings)
        files = {"file": (csv_filename, csv_bytes, "text/csv")}
        async with httpx.AsyncClient() as client:
            r = await client.post(
                f"{BASE_URL}/api/bff/broadcast/schedule-csv/",
                headers=headers,
                data=data,
                files=files,
                timeout=30,
            )
            if not r.is_success:
                body = r.text[:500]
                raise ValueError(f"VendeAI dispatch {r.status_code}: {body}")
            return r.json() if r.content else {"ok": True}

    async def list_templates(self) -> list[dict]:
        """Returns list of approved WhatsApp message templates."""
        token = await self._ensure_token()
        async with httpx.AsyncClient() as client:
            r = await client.get(
                f"{BASE_URL}/api/bff/broadcast/templates/",
                headers=self._headers(token),
                timeout=15,
            )
            r.raise_for_status()
            data = r.json()
            if isinstance(data, list):
                return data
            return data.get("results") or data.get("templates") or []

    async def pause(self, mailing_id: str) -> dict:
        token = await self._ensure_token()
        async with httpx.AsyncClient() as client:
            r = await client.post(
                f"{BASE_URL}/api/bff/broadcast/pause/",
                headers=self._headers(token),
                json={"mailing_id": mailing_id},
                timeout=15,
            )
            r.raise_for_status()
            return r.json() if r.content else {"ok": True}

    async def resume(self, mailing_id: str) -> dict:
        token = await self._ensure_token()
        async with httpx.AsyncClient() as client:
            r = await client.post(
                f"{BASE_URL}/api/bff/broadcast/resume/",
                headers=self._headers(token),
                json={"mailing_id": mailing_id},
                timeout=15,
            )
            r.raise_for_status()
            return r.json() if r.content else {"ok": True}

    async def cancel(self, mailing_id: str) -> dict:
        token = await self._ensure_token()
        async with httpx.AsyncClient() as client:
            r = await client.post(
                f"{BASE_URL}/api/bff/broadcast/revoke/",
                headers=self._headers(token),
                json={"mailing_id": mailing_id},
                timeout=15,
            )
            r.raise_for_status()
            return r.json() if r.content else {"ok": True}
