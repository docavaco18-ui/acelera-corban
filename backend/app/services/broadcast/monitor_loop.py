from __future__ import annotations

import asyncio
import json
import logging

import redis.asyncio as aioredis

from app.config import settings
from app.credentials.crypto import decrypt
from app.database import get_db
from app.services.broadcast.intervention import evaluate_and_intervene
from app.services.broadcast.meta_client import MetaClient
from app.services.broadcast.vendeai_client import VendeAIClient

logger = logging.getLogger(__name__)
POLL_INTERVAL = 60


async def monitor_tick(redis_client: aioredis.Redis) -> None:
    db = get_db()

    # Find all users with active dispatches
    active = db.table("broadcast_dispatches") \
        .select("owner_id") \
        .in_("status", ["running"]) \
        .execute()

    owner_ids = list({row["owner_id"] for row in (active.data or [])})

    for owner_id in owner_ids:
        try:
            await _process_owner(db, owner_id, redis_client)
        except Exception as e:
            logger.exception(f"Monitor error for owner {owner_id}: {e}")


async def _process_owner(db, owner_id: str, redis_client: aioredis.Redis) -> None:
    # Load credentials
    creds_resp = db.table("vendeai_settings") \
        .select("email_enc, password_enc, meta_token_enc") \
        .eq("owner_id", owner_id) \
        .single() \
        .execute()

    if not creds_resp.data:
        return

    creds = creds_resp.data
    email = decrypt(creds.get("email_enc"))
    password = decrypt(creds.get("password_enc"))
    meta_token = decrypt(creds.get("meta_token_enc"))

    if not email or not password:
        return

    vendeai = VendeAIClient(email, password)

    # 1. Poll VendeAI mailings → update sent/failed counts
    try:
        mailings_data = await vendeai.list_mailings(page=1, page_size=100)
        for mailing in mailings_data.get("results", []):
            mailing_id = mailing.get("id")
            if not mailing_id:
                continue
            asn_resp = db.table("broadcast_dispatch_assignments") \
                .select("id") \
                .eq("vendeai_mailing_id", mailing_id) \
                .eq("owner_id", owner_id) \
                .execute()
            if asn_resp.data:
                db.table("broadcast_dispatch_assignments").update({
                    "sent_count": mailing.get("sent_count", 0),
                    "failed_count": mailing.get("dispatch_total", 0) - mailing.get("sent_count", 0),
                    "last_poll_at": "now()",
                }).eq("id", asn_resp.data[0]["id"]).execute()
    except Exception as e:
        logger.warning(f"VendeAI poll failed for {owner_id}: {e}")

    # 2. Poll Meta API → update quality/tier
    if meta_token:
        try:
            meta = MetaClient(meta_token)
            numbers_resp = db.table("broadcast_numbers") \
                .select("phone_id,quality_rating") \
                .eq("owner_id", owner_id) \
                .execute()
            for num in (numbers_resp.data or []):
                try:
                    quality_data = await meta.get_phone_quality(num["phone_id"])
                    update_fields = {
                        "quality_rating": quality_data["quality_rating"],
                        "messaging_tier": quality_data["messaging_tier"],
                        "daily_limit": quality_data["daily_limit"],
                        "can_send": quality_data["can_send"],
                        "last_meta_check_at": "now()",
                    }
                    # Track previous quality for change detection
                    if num.get("quality_rating") and num["quality_rating"] != quality_data["quality_rating"]:
                        update_fields["quality_previous"] = num["quality_rating"]
                    db.table("broadcast_numbers").update(update_fields) \
                        .eq("owner_id", owner_id).eq("phone_id", num["phone_id"]).execute()
                except Exception as e:
                    logger.warning(f"Meta poll failed for {num['phone_id']}: {e}")
        except Exception as e:
            logger.warning(f"Meta polling failed for {owner_id}: {e}")

    # 3. Evaluate interventions
    try:
        alerts = await evaluate_and_intervene(db, owner_id, vendeai)
        for alert in alerts:
            await redis_client.publish(
                "broadcast:events",
                json.dumps({
                    "user_id": owner_id,
                    "type": "broadcast.alert",
                    "alert_type": alert.get("alert_type"),
                    "phone_id": alert.get("phone_id"),
                    "severity": alert.get("severity"),
                    "message": alert.get("message"),
                }),
            )
    except Exception as e:
        logger.warning(f"Intervention failed for {owner_id}: {e}")

    # 4. Publish snapshot
    try:
        numbers = db.table("broadcast_numbers").select("*").eq("owner_id", owner_id).execute()
        dispatches = db.table("broadcast_dispatches") \
            .select("*, broadcast_dispatch_assignments(*)") \
            .eq("owner_id", owner_id) \
            .in_("status", ["running", "paused"]) \
            .execute()
        alerts_recent = db.table("broadcast_alerts") \
            .select("*") \
            .eq("owner_id", owner_id) \
            .order("ts", desc=True) \
            .limit(20) \
            .execute()

        await redis_client.publish(
            "broadcast:events",
            json.dumps({
                "user_id": owner_id,
                "type": "broadcast.snapshot",
                "numbers": numbers.data or [],
                "dispatches": dispatches.data or [],
                "alerts": alerts_recent.data or [],
            }, default=str),
        )
    except Exception as e:
        logger.warning(f"Snapshot publish failed for {owner_id}: {e}")


async def run_monitor_loop(redis_client: aioredis.Redis) -> None:
    logger.info("Broadcast monitor loop started")
    while True:
        try:
            await monitor_tick(redis_client)
        except Exception as e:
            logger.exception(f"Monitor tick error: {e}")
        await asyncio.sleep(POLL_INTERVAL)
