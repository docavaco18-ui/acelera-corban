from __future__ import annotations

from typing import Optional

import httpx

META_BASE = "https://graph.facebook.com/v19.0"


class MetaClient:
    def __init__(self, access_token: str):
        self.access_token = access_token

    async def get_phone_quality(self, phone_id: str) -> dict:
        """Returns {phone_id, display_phone, quality_rating, messaging_tier, daily_limit}."""
        async with httpx.AsyncClient() as client:
            r = await client.get(
                f"{META_BASE}/{phone_id}",
                params={
                    "fields": "quality_rating,messaging_limit_tier,display_phone_number",
                    "access_token": self.access_token,
                },
                timeout=15,
            )
            r.raise_for_status()
            data = r.json()

        tier = data.get("messaging_limit_tier", "TIER_1K")
        tier_map = {
            "TIER_1K": ("1K", 1000),
            "TIER_10K": ("10K", 10000),
            "TIER_100K": ("100K", 100000),
        }
        tier_label, daily_limit = tier_map.get(tier, ("1K", 1000))

        return {
            "phone_id": phone_id,
            "display_phone": data.get("display_phone_number", ""),
            "quality_rating": data.get("quality_rating", "UNKNOWN"),
            "messaging_tier": tier_label,
            "daily_limit": daily_limit,
        }

    async def get_all_phones(self, waba_id: str) -> list[dict]:
        """List all phone numbers under a WABA."""
        async with httpx.AsyncClient() as client:
            r = await client.get(
                f"{META_BASE}/{waba_id}/phone_numbers",
                params={
                    "fields": "id,display_phone_number,quality_rating,messaging_limit_tier",
                    "access_token": self.access_token,
                },
                timeout=15,
            )
            r.raise_for_status()
            data = r.json()

        results = []
        for p in data.get("data", []):
            tier = p.get("messaging_limit_tier", "TIER_1K")
            tier_map = {
                "TIER_1K": ("1K", 1000),
                "TIER_10K": ("10K", 10000),
                "TIER_100K": ("100K", 100000),
            }
            tier_label, daily_limit = tier_map.get(tier, ("1K", 1000))
            results.append({
                "phone_id": p["id"],
                "display_phone": p.get("display_phone_number", ""),
                "quality_rating": p.get("quality_rating", "UNKNOWN"),
                "messaging_tier": tier_label,
                "daily_limit": daily_limit,
            })
        return results
