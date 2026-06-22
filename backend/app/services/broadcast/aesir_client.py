from __future__ import annotations

import asyncio
import csv
import io
import logging
from typing import Any

import httpx

BASE_URL = "https://api.aesirerp.com/api/v1"
log = logging.getLogger(__name__)


class AesirClient:
    def __init__(self, api_token: str, account_id: str):
        self.api_token = api_token
        self.account_id = account_id

    def _headers(self) -> dict:
        return {
            "X-Token": self.api_token,
            "X-Account-ID": self.account_id,
            "Accept": "application/json",
            "Content-Type": "application/json",
        }

    async def send_template(
        self,
        instance_id: str,
        number: str,
        template_name: str,
        variables: list[str] | None = None,
        instance_type: str = "waba",
        language: str | None = None,
        campaign_name: str | None = None,
    ) -> dict:
        """POST /whatsapp/send-template — envia template oficial PELO Aesir.

        Aesir registra no Chat do contato e agrupa em campanha (Gerenciador de
        Campanhas) quando `campaign_name` é informado. Raises em non-2xx.
        """
        payload: dict[str, Any] = {
            "instance_id": instance_id,
            "instance_type": instance_type,
            "number": number,
            "template_name": template_name,
        }
        if variables:
            payload["variables"] = variables
        if language:
            payload["language"] = language
        if campaign_name:
            payload["campaign_name"] = campaign_name
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.post(
                f"{BASE_URL}/whatsapp/send-template",
                headers=self._headers(),
                json=payload,
            )
            r.raise_for_status()
            return r.json()

    async def create_campaign(
        self,
        campaign_name: str,
        instance_id: str,
        instance_type: str,
        template_name: str,
        interval_seconds: int,
        recipients: list[dict],
    ) -> dict:
        """POST /campaigns — cria campanha em lote; registra no Gerenciador de Campanhas."""
        payload: dict[str, Any] = {
            "campaign_name": campaign_name,
            "instance_id": int(instance_id),
            "instance_type": instance_type,
            "template_name": template_name,
            "interval_seconds": max(1, interval_seconds),
            "recipients": recipients,
        }
        async with httpx.AsyncClient(timeout=60) as client:
            r = await client.post(
                f"{BASE_URL}/campaigns",
                headers=self._headers(),
                json=payload,
            )
            r.raise_for_status()
            return r.json()

    async def get_campaign(self, campaign_id: int | str) -> dict:
        """GET /campaigns/{id} — métricas da campanha (total, sent, errors, ignored)."""
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(
                f"{BASE_URL}/campaigns/{campaign_id}",
                headers=self._headers(),
            )
            r.raise_for_status()
            return r.json()

    async def list_instances(self) -> list[dict]:
        """GET /whatsapp/instances — lista instâncias WA do tenant."""
        async with httpx.AsyncClient() as client:
            r = await client.get(
                f"{BASE_URL}/whatsapp/instances",
                headers=self._headers(),
                timeout=15,
            )
            r.raise_for_status()
            data = r.json()
            if isinstance(data, list):
                return data
            return data.get("data") or data.get("instances") or []

    async def dispatch_csv(
        self,
        csv_bytes: bytes,
        instance_id: str,
        message_tpl: str,
        phone_column: str = "telefone",
        cooldown_seconds: int = 5,
        stop_event: asyncio.Event | None = None,
        instance_type: str = "waba",
    ) -> dict[str, Any]:
        """Loop through CSV rows, send one message per contact.

        Returns {sent, errors, total}.
        """
        text = csv_bytes.lstrip(b"\xef\xbb\xbf").decode("utf-8", errors="replace")
        rows = list(csv.DictReader(io.StringIO(text)))

        sent = 0
        errors = 0

        async with httpx.AsyncClient(timeout=15) as client:
            for i, row in enumerate(rows):
                if stop_event and stop_event.is_set():
                    log.info("aesir_dispatch stopped by stop_event")
                    break

                phone_raw = ""
                for col in [phone_column, "telefone", "phone", "celular", "numero", "whatsapp"]:
                    if col in row and row[col]:
                        phone_raw = row[col]
                        break
                phone = "".join(c for c in phone_raw if c.isdigit())
                if not phone or not (10 <= len(phone) <= 13):
                    errors += 1
                    log.debug("aesir_skip invalid_phone raw=%r digits=%r", phone_raw, phone)
                    continue

                message = message_tpl
                for key, val in row.items():
                    message = message.replace(f"{{{{{key}}}}}", str(val or ""))

                try:
                    r = await client.post(
                        f"{BASE_URL}/whatsapp/send-message",
                        headers=self._headers(),
                        json={
                            "instance_id": instance_id,
                            "instance_type": instance_type,
                            "number": phone,
                            "message": message,
                        },
                    )
                    r.raise_for_status()
                    sent += 1
                    log.info(f"aesir_sent phone={phone} instance={instance_id}")
                except Exception as exc:
                    errors += 1
                    log.warning("aesir_send_error phone=%s error=%s: %s", phone, type(exc).__name__, str(exc)[:120])

                # sleep between rows, skip after last
                if i < len(rows) - 1:
                    await asyncio.sleep(cooldown_seconds)

        return {"sent": sent, "errors": errors, "total": sent + errors}
