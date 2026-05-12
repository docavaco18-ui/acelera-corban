from __future__ import annotations

import re

import httpx

META_BASE = "https://graph.facebook.com/v19.0"

THROUGHPUT_MAP = {
    "STANDARD":       ("250/dia",   250),
    "HIGH":           ("1K/dia",    1000),
    "VERY_HIGH":      ("10K/dia",   10000),
    "NOT_APPLICABLE": ("—",         0),
}


def _parse_phone(data: dict) -> dict:
    throughput_level = (data.get("throughput") or {}).get("level", "NOT_APPLICABLE")
    tier_label, daily_limit = THROUGHPUT_MAP.get(throughput_level, ("—", 0))

    hs = data.get("health_status") or {}
    can_send = hs.get("can_send_message", "UNKNOWN")

    # Collect restriction reasons (ignore SIP noise 138024/138025)
    restrictions = []
    for ent in hs.get("entities", []):
        for err in ent.get("errors", []):
            code = err.get("error_code")
            if code in (138024, 138025):
                continue
            restrictions.append(code)

    return {
        "phone_id": data.get("id", ""),
        "display_phone": data.get("display_phone_number", ""),
        "quality_rating": data.get("quality_rating", "UNKNOWN"),
        "throughput_level": throughput_level,
        "messaging_tier": tier_label,
        "daily_limit": daily_limit,
        "can_send": can_send,
        "name_status": data.get("name_status", "UNKNOWN"),
        "phone_status": data.get("status", "UNKNOWN"),
        "restriction_codes": restrictions,
    }


PHONE_FIELDS = (
    "id,display_phone_number,quality_rating,throughput,"
    "health_status,name_status,status"
)


def _extract_template_variables(components: list) -> list[str]:
    """Extract {{N}} variable positions from template components."""
    seen: set[str] = set()
    variables: list[str] = []
    for comp in components:
        for part in [comp.get("text", "")] + [
            btn.get("url", "") for btn in comp.get("buttons", [])
        ]:
            for match in re.findall(r"\{\{(\d+)\}\}", part or ""):
                if match not in seen:
                    seen.add(match)
                    variables.append(match)
    return sorted(variables, key=lambda x: int(x))


class MetaClient:
    def __init__(self, access_token: str):
        self.access_token = access_token

    async def get_phone_quality(self, phone_id: str) -> dict:
        async with httpx.AsyncClient() as client:
            r = await client.get(
                f"{META_BASE}/{phone_id}",
                params={"fields": PHONE_FIELDS, "access_token": self.access_token},
                timeout=15,
            )
            r.raise_for_status()
        return _parse_phone(r.json())

    async def get_all_phones(self, waba_id: str) -> list[dict]:
        all_phones: list[dict] = []
        url: str | None = f"{META_BASE}/{waba_id}/phone_numbers"
        params: dict = {"fields": PHONE_FIELDS, "access_token": self.access_token, "limit": 100}

        async with httpx.AsyncClient() as client:
            while url:
                r = await client.get(url, params=params, timeout=15)
                r.raise_for_status()
                data = r.json()
                all_phones.extend(_parse_phone(p) for p in data.get("data", []))
                url = (data.get("paging") or {}).get("next")
                params = {}  # next URL already has all params embedded

        return all_phones

    async def get_templates(self, waba_id: str) -> list[dict]:
        """Returns APPROVED message templates for a WABA with their variables."""
        async with httpx.AsyncClient() as client:
            r = await client.get(
                f"{META_BASE}/{waba_id}/message_templates",
                params={
                    "fields": "id,name,status,language,category,components",
                    "status": "APPROVED",
                    "limit": 200,
                    "access_token": self.access_token,
                },
                timeout=15,
            )
            r.raise_for_status()
            data = r.json()

        results = []
        for t in data.get("data", []):
            components = t.get("components", [])
            variables = _extract_template_variables(components)
            body = next((c.get("text", "") for c in components if c.get("type") == "BODY"), "")
            results.append({**t, "variables": variables, "body": body})
        return results
