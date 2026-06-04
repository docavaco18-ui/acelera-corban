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
    sa_list_tpl: str = "40431d7dacd2374aaaaa250e1993d7c8c512d4eef2"  # getCommonChannelTemplates
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
        """Login + select tenant. Returns JWT token string.

        Chipcare auth flow (captured 2026-06-04):
        1. POST /api/auth {email, senha} → {requiresTenantSelection, availableTenants}
        2. POST /api/auth/select-tenant {email, senha, tenantId} → {token, message}
        """
        async with httpx.AsyncClient(follow_redirects=False) as client:
            r = await client.post(
                f"{BASE_URL}/api/auth",
                json={"email": self.email, "senha": self.password},
                headers={"Content-Type": "application/json", "Accept": "application/json, text/plain, */*"},
                timeout=15,
            )
            r.raise_for_status()
            data = r.json()

            # Step 2: always required — select tenant and get JWT
            tenants = data.get("availableTenants") or []

            # Resolve tenant_id: use provided name/id, else first available
            resolved_tenant_id: int | None = None
            for t in tenants:
                t_name = (t.get("tenantName") or t.get("tenantSlug") or "").lower()
                t_id = t.get("tenantId")
                t_user_id = t.get("userId")
                if tenant_id and (str(t_id) == str(tenant_id) or t_name == tenant_id.lower()):
                    resolved_tenant_id = t_id
                    self._user_id = str(t_user_id or "")
                    break
            if resolved_tenant_id is None and tenants:
                resolved_tenant_id = tenants[0]["tenantId"]
                self._user_id = str(tenants[0].get("userId") or "")

            if resolved_tenant_id is None:
                raise ValueError(f"Login falhou — nenhum tenant disponível: {data}")

            r2 = await client.post(
                f"{BASE_URL}/api/auth/select-tenant",
                json={"email": self.email, "senha": self.password, "tenantId": resolved_tenant_id},
                headers={"Content-Type": "application/json", "Accept": "application/json, text/plain, */*"},
                timeout=10,
            )
            r2.raise_for_status()
            data2 = r2.json()
            token = data2.get("token") or data2.get("accessToken") or data2.get("access_token") or ""

            if not token:
                raise ValueError(f"Login falhou — sem token após select-tenant: {data2}")

            self._jwt = token
            log.info("chipcare login ok tenant_id=%s user_id=%s", resolved_tenant_id, self._user_id)

        return self._jwt

    async def _select_tenant(
        self, client: httpx.AsyncClient, token: str, tenant_id: str
    ) -> None:
        # Kept for backwards compat but superseded by login() flow above
        pass

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

    async def list_templates(self, jwt: str, channel_ids: list[int] | None = None) -> list[dict]:
        """SA getCommonChannelTemplates — retorna templates HSM APPROVED comuns aos canais.

        channel_ids: IDs dos canais WHATSAPP_OFFICIAL ativos (sem filtro = todos).
        Body: [[channelId, ...]] — array aninhado é o contrato do SA.
        """
        async with httpx.AsyncClient() as client:
            r = await client.post(
                f"{BASE_URL}/admin/campanhas",
                headers=self._headers_sa(jwt, self.hashes.sa_list_tpl),
                content=json.dumps([channel_ids or []]),
                timeout=15,
            )
            r.raise_for_status()
            result = _parse_rsc_json(r.text)
            if isinstance(result, list) and len(result) > 0:
                templates = []
                for item in result:
                    if isinstance(item, list):
                        templates = item
                        break
                    elif isinstance(item, dict) and "id" in item:
                        templates.append(item)
                if not templates:
                    log.warning("chipcare list_templates: RSC parsed %d items but extracted 0 templates — hash may be stale. Raw[:200]: %s", len(result), r.text[:200])
                return templates
            log.warning("chipcare list_templates: RSC parse returned no JSON objects — hash may be stale. Status=%s Raw[:200]: %s", r.status_code, r.text[:200])
            return []

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

        user_id = self._user_id
        if not user_id:
            raise ValueError("chipcare user_id não resolvido — chame login() antes de create_campaign()")
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
