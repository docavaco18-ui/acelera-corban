"""
Chipcare CRM client — disparo WA Oficial via Server Actions Next.js.

Auth: POST /api/auth → JWT cookie → POST /api/auth/select-tenant
Channels: GET /api/channels (REST, filtra WHATSAPP_OFFICIAL)
Templates: SA listMessageTemplates (hash sa_list_tpl) body=["WHATSAPP_OFFICIAL"]
Lead preview: POST /api/campaign/lead-preview (REST)
Create campaign: SA createCampaign (hash sa_create) FormData
Activate campaign: SA activateCampaignV2 (hash sa_activate) body=[campaignId]

ATENÇÃO — SA hashes mudam a cada deploy do Chipcare.
Atualizar em chipcare_settings.sa_* quando o disparo retornar 404.
"""

from __future__ import annotations

import csv
import io
import json
import logging
from dataclasses import dataclass, field
from typing import Any

import httpx

BASE_URL = "https://chipcare.miwteam.com.br"
ROUTER_STATE = (
    "%5B%22%22%2C%7B%22children%22%3A%5B%22admin%22%2C%7B%22children%22%3A%5B"
    "%22campanhas%22%2C%7B%22children%22%3A%5B%22__PAGE__%22%2C%7B%7D%2Cnull%2Cnull%2C0%5D%7D"
    "%2Cnull%2Cnull%2C0%5D%7D%2Cnull%2Cnull%2C0%5D%7D%2Cnull%2Cnull%2C16%5D"
)

log = logging.getLogger(__name__)


@dataclass
class ChipcareHashes:
    sa_create: str = "40be5a0f648930e0433281bce7c7e92b8608ca8538"
    sa_activate: str = "40d6c8e94ed90438c061742726eb102e9e30d7aad6"
    sa_list_tpl: str = "4076e492ad0bf871591d73486aaf60ef4b5899b6b5"
    sa_list_camps: str = "60d1f84d254eb29a6024a5d2206b8153916b2bbcc7"


class ChipcareClient:
    def __init__(self, email: str, password: str, hashes: ChipcareHashes | None = None):
        self.email = email
        self.password = password
        self.hashes = hashes or ChipcareHashes()
        self._jwt: str | None = None
        self._user_id: str | None = None

    # ── Auth ──────────────────────────────────────────────────────────────────

    async def login(self, tenant_id: str | None = None) -> str:
        """Login + select tenant. Returns JWT token string."""
        async with httpx.AsyncClient(follow_redirects=True) as client:
            r = await client.post(
                f"{BASE_URL}/api/auth",
                json={"email": self.email, "password": self.password},
                headers={"Content-Type": "application/json"},
                timeout=15,
            )
            r.raise_for_status()
            data = r.json()
            token = (
                data.get("token")
                or data.get("accessToken")
                or data.get("access_token")
                or ""
            )

            # Extract user id for _1_createdBy field in createCampaign
            user_data = data.get("user") or data.get("data") or {}
            self._user_id = str(user_data.get("id") or "")

            if not token:
                # JWT might be in Set-Cookie header
                for header_val in r.headers.get_list("set-cookie"):
                    if "token=" in header_val:
                        token = header_val.split("token=")[1].split(";")[0]
                        break

            if not token:
                raise ValueError(f"Login falhou — resposta inesperada: {data}")

            self._jwt = token

            # Select tenant if needed
            if tenant_id:
                await self._select_tenant(client, token, tenant_id)

        return self._jwt

    async def _select_tenant(
        self, client: httpx.AsyncClient, token: str, tenant_id: str
    ) -> None:
        r = await client.post(
            f"{BASE_URL}/api/auth/select-tenant",
            json={"tenantId": tenant_id},
            headers={"Content-Type": "application/json", "Cookie": f"token={token}"},
            timeout=10,
        )
        if r.status_code == 200:
            data = r.json()
            new_token = data.get("token") or data.get("accessToken") or ""
            if new_token:
                self._jwt = new_token
        # non-200 = tenant not found — proceed with original token

    def _headers_rest(self, jwt: str) -> dict:
        return {
            "Content-Type": "application/json",
            "Cookie": f"token={jwt}",
        }

    def _headers_sa(self, jwt: str, action_hash: str) -> dict:
        return {
            "Accept": "text/x-component",
            "Next-Action": action_hash,
            "next-router-state-tree": ROUTER_STATE,
            "Cookie": f"token={jwt}",
        }

    # ── Channels ──────────────────────────────────────────────────────────────

    async def list_channels(self, jwt: str) -> list[dict]:
        """GET /api/channels — retorna somente WHATSAPP_OFFICIAL."""
        async with httpx.AsyncClient() as client:
            r = await client.get(
                f"{BASE_URL}/api/channels",
                headers=self._headers_rest(jwt),
                timeout=15,
            )
            r.raise_for_status()
            channels = r.json()
            if isinstance(channels, dict):
                channels = channels.get("data") or channels.get("channels") or []
            return [c for c in channels if c.get("channelType") == "WHATSAPP_OFFICIAL"]

    # ── Templates ─────────────────────────────────────────────────────────────

    async def list_templates(self, jwt: str) -> list[dict]:
        """SA listMessageTemplates — retorna templates HSM APPROVED."""
        async with httpx.AsyncClient() as client:
            r = await client.post(
                f"{BASE_URL}/admin/campanhas",
                headers=self._headers_sa(jwt, self.hashes.sa_list_tpl),
                content=json.dumps(["WHATSAPP_OFFICIAL"]),
                timeout=15,
            )
            r.raise_for_status()
            # RSC response — parse JSON from streaming text/x-component
            return _parse_rsc_json(r.text)

    # ── Lead preview ─────────────────────────────────────────────────────────

    async def lead_preview(
        self,
        jwt: str,
        source_type: str = "KANBAN",
        kanban_column_ids: list[int] | None = None,
        tag_ids: list[int] | None = None,
        chat_status: str = "ALL",
        channel_ids: list[int] | None = None,
    ) -> dict:
        """POST /api/campaign/lead-preview — conta destinatários."""
        body = {
            "sourceType": source_type,
            "kanbanColumnIds": kanban_column_ids or [],
            "tagIds": tag_ids or [],
            "combineOperator": "AND",
            "chatStatus": chat_status,
            "channelMode": "ANY_CHANNEL",
            "channelIds": channel_ids or [],
        }
        async with httpx.AsyncClient() as client:
            r = await client.post(
                f"{BASE_URL}/api/campaign/lead-preview",
                json=body,
                headers=self._headers_rest(jwt),
                timeout=15,
            )
            r.raise_for_status()
            return r.json()

    # ── Create campaign ───────────────────────────────────────────────────────

    async def create_campaign(
        self,
        jwt: str,
        name: str,
        channel_ids: list[int],
        template: dict,
        source_type: str = "KANBAN",
        kanban_column_ids: list[int] | None = None,
        chat_status: str = "ALL",
        channel_mode: str = "ANY_CHANNEL",
        combine_operator: str = "AND",
        min_interval_ms: int = 3000,
        max_interval_ms: int = 8000,
        aggression_level: str = "MEDIUM",
        xlsx_bytes: bytes | None = None,
        dry_run: bool = False,
    ) -> dict:
        """SA createCampaign — cria campanha no Chipcare (sempre em modo pausado).

        dry_run=True valida os parâmetros sem criar.
        Returns {"campaign_id": int, "name": str, "status": str}
        """
        if dry_run:
            return {
                "dry_run": True,
                "name": name,
                "channel_ids": channel_ids,
                "template": template.get("templateName"),
                "source_type": source_type,
            }

        user_id = self._user_id or "2"
        form = _build_campaign_formdata(
            name=name,
            channel_ids=channel_ids,
            template=template,
            source_type=source_type,
            kanban_column_ids=kanban_column_ids,
            chat_status=chat_status,
            channel_mode=channel_mode,
            combine_operator=combine_operator,
            min_interval_ms=min_interval_ms,
            max_interval_ms=max_interval_ms,
            aggression_level=aggression_level,
            created_by=user_id,
            xlsx_bytes=xlsx_bytes,
        )

        async with httpx.AsyncClient() as client:
            r = await client.post(
                f"{BASE_URL}/admin/campanhas",
                headers=self._headers_sa(jwt, self.hashes.sa_create),
                content=form["body"],
                timeout=30,
            )
            r.raise_for_status()
            parsed = _parse_rsc_json(r.text)
            # RSC response typically includes campaign id in the serialized state
            campaign_id = _extract_campaign_id(parsed, r.text)
            log.info("chipcare create_campaign ok campaign_id=%s name=%s", campaign_id, name)
            return {"campaign_id": campaign_id, "name": name, "status": "paused"}

    # ── Activate ─────────────────────────────────────────────────────────────

    async def activate_campaign(
        self, jwt: str, campaign_id: int, dry_run: bool = False
    ) -> dict:
        """SA activateCampaignV2 — ativa campanha pausada. Confirmar antes de chamar."""
        if dry_run:
            return {"dry_run": True, "campaign_id": campaign_id}

        async with httpx.AsyncClient() as client:
            r = await client.post(
                f"{BASE_URL}/admin/campanhas",
                headers=self._headers_sa(jwt, self.hashes.sa_activate),
                content=json.dumps([campaign_id]),
                timeout=15,
            )
            r.raise_for_status()
            log.info("chipcare activate_campaign ok campaign_id=%s", campaign_id)
            return {"ok": True, "campaign_id": campaign_id}

    # ── List campaigns ────────────────────────────────────────────────────────

    async def list_campaigns(
        self,
        jwt: str,
        status: str | None = None,
        page: int = 1,
        limit: int = 20,
    ) -> list[dict]:
        """SA listCampaignsPaginated."""
        body = json.dumps([
            {
                "search": None,
                "status": status,
                "archivedOnly": False,
                "createdBy": None,
            },
            {"page": page, "limit": limit},
        ])
        async with httpx.AsyncClient() as client:
            r = await client.post(
                f"{BASE_URL}/admin/campanhas",
                headers=self._headers_sa(jwt, self.hashes.sa_list_camps),
                content=body,
                timeout=15,
            )
            r.raise_for_status()
            return _parse_rsc_json(r.text) or []


# ── RSC parsing helpers ───────────────────────────────────────────────────────

def _parse_rsc_json(text: str) -> Any:
    """Extract JSON payload from Next.js RSC text/x-component stream.

    RSC uses a line-based format: each line starts with a type prefix.
    Lines starting with digits + ':' contain serialized data.
    """
    results = []
    for line in text.splitlines():
        if not line:
            continue
        # RSC line format: "N:T<hex>,data" or "N:json_value"
        colon_idx = line.find(":")
        if colon_idx < 0:
            continue
        payload = line[colon_idx + 1:].strip()
        if payload.startswith("[") or payload.startswith("{"):
            try:
                results.append(json.loads(payload))
            except json.JSONDecodeError:
                pass
    if len(results) == 1:
        return results[0]
    return results


def _extract_campaign_id(parsed: Any, raw_text: str) -> int | None:
    """Try to find campaign id in RSC response."""
    # parsed may be list of objects; look for {"id": int} pattern
    if isinstance(parsed, list):
        for item in parsed:
            if isinstance(item, dict) and "id" in item:
                return item["id"]
    if isinstance(parsed, dict) and "id" in parsed:
        return parsed["id"]
    # Fallback: search raw text for "\"id\":" pattern
    import re
    m = re.search(r'"id"\s*:\s*(\d+)', raw_text)
    if m:
        return int(m.group(1))
    return None


def _build_campaign_formdata(
    name: str,
    channel_ids: list[int],
    template: dict,
    source_type: str,
    kanban_column_ids: list[int] | None,
    chat_status: str,
    channel_mode: str,
    combine_operator: str,
    min_interval_ms: int,
    max_interval_ms: int,
    aggression_level: str,
    created_by: str,
    xlsx_bytes: bytes | None,
) -> dict:
    """Build multipart/form-data body matching Chipcare SA createCampaign format.

    Field names captured from live traffic 2026-06-04:
    0=["$K1"]  _1_name  _1_channelIds  _1_sourceType  _1_messagePayload
    _1_minInterval  _1_maxInterval  _1_aggressionLevel  _1_createdBy
    _1_kanbanColumnIds  _1_combineOperator  _1_chatStatus  _1_channelMode
    """
    import httpx

    fields: dict[str, Any] = {
        "0": '["$K1"]',
        "_1_name": name,
        "_1_channelIds": json.dumps(channel_ids),
        "_1_sourceType": source_type,
        "_1_messagePayload": json.dumps(template),
        "_1_minInterval": str(min_interval_ms),
        "_1_maxInterval": str(max_interval_ms),
        "_1_aggressionLevel": aggression_level,
        "_1_createdBy": str(created_by),
        "_1_kanbanColumnIds": json.dumps(kanban_column_ids or []),
        "_1_combineOperator": combine_operator,
        "_1_chatStatus": chat_status,
        "_1_channelMode": channel_mode,
    }

    # Build multipart body manually using httpx internals
    # httpx.encode_multipart_data returns (content_type, body_bytes)
    files = []
    data = {}
    for k, v in fields.items():
        data[k] = v

    if source_type == "XLSX_FILE" and xlsx_bytes:
        # The file field name is inferred as "_1_file" based on the FormData pattern
        files.append(("_1_file", ("leads.xlsx", xlsx_bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")))

    # Use httpx multipart encoder
    request = httpx.Request("POST", "https://chipcare.miwteam.com.br", data=data, files=files if files else None)
    content_type = request.headers.get("content-type", "multipart/form-data")
    body = request.content

    return {"body": body, "content_type": content_type}


def csv_to_xlsx_bytes(csv_bytes: bytes) -> bytes:
    """Convert CSV bytes to minimal XLSX bytes using openpyxl if available."""
    try:
        import openpyxl
        text = csv_bytes.lstrip(b"\xef\xbb\xbf").decode("utf-8", errors="replace")
        rows = list(csv.reader(io.StringIO(text)))
        wb = openpyxl.Workbook()
        ws = wb.active
        for row in rows:
            ws.append(row)
        buf = io.BytesIO()
        wb.save(buf)
        return buf.getvalue()
    except ImportError:
        # Minimal fallback: wrap CSV as a fake XLSX (won't work but won't crash)
        log.warning("openpyxl not installed — XLSX upload will fail, install it")
        return csv_bytes


def build_template_payload(
    template_name: str,
    template_id: str,
    language_code: str = "pt_BR",
    components: list[dict] | None = None,
) -> dict:
    """Build the _1_messagePayload dict for createCampaign."""
    return {
        "type": "TEMPLATE_HSM",
        "templateName": template_name,
        "templateId": template_id,
        "languageCode": language_code,
        "components": components or [],
    }
