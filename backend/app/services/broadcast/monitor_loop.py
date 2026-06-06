from __future__ import annotations

import asyncio
import json
import logging

import redis.asyncio as aioredis

from datetime import datetime, timezone

from app.config import settings
from app.credentials.crypto import safe_decrypt as decrypt
from app.database import get_db
from app.services.broadcast.intervention import evaluate_and_intervene
from app.services.broadcast.meta_client import MetaClient
from app.services.broadcast.vendeai_client import VendeAIClient

_vendeai_cache: dict[str, VendeAIClient] = {}


def _utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()

logger = logging.getLogger(__name__)
POLL_INTERVAL = 20


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
    try:
        creds_resp = db.table("vendeai_settings") \
            .select("email_enc, password_enc, meta_token_enc") \
            .eq("owner_id", owner_id) \
            .single() \
            .execute()
    except Exception:
        return

    if not creds_resp.data:
        return

    creds = creds_resp.data

    # Tolerate corrupted/empty encrypted fields — skip owner if core creds bad
    try:
        email = decrypt(creds.get("email_enc")) if creds.get("email_enc") else None
        password = decrypt(creds.get("password_enc")) if creds.get("password_enc") else None
    except Exception as e:
        logger.warning(f"Decrypt VendeAI creds failed for {owner_id}: {e}")
        return

    try:
        meta_token = decrypt(creds.get("meta_token_enc")) if creds.get("meta_token_enc") else None
    except Exception as e:
        logger.warning(f"Decrypt meta token failed for {owner_id}: {e}")
        meta_token = None

    if not email or not password:
        return

    # Reuse client so the token is not refreshed every tick
    cache_key = f"{owner_id}:{email}"
    if cache_key not in _vendeai_cache:
        _vendeai_cache[cache_key] = VendeAIClient(email, password)
    vendeai = _vendeai_cache[cache_key]

    # 1. Poll VendeAI mailings → update sent/failed counts
    # Load only active mailing IDs to avoid full-scan pagination
    try:
        active_asns = db.table("broadcast_dispatch_assignments") \
            .select("id,vendeai_mailing_id") \
            .eq("owner_id", owner_id) \
            .in_("status", ["running", "paused"]) \
            .not_.is_("vendeai_mailing_id", "null") \
            .execute()

        # Paginate all mailings until we find all tracked IDs
        tracked_ids = {a["vendeai_mailing_id"]: a["id"] for a in (active_asns.data or [])}
        if tracked_ids:
            page, found = 1, 0
            while found < len(tracked_ids):
                mailings_data = await vendeai.list_mailings(page=page, page_size=100)
                results = mailings_data.get("results", [])
                if not results:
                    break
                for mailing in results:
                    mailing_id = str(mailing.get("id") or "")
                    if mailing_id in tracked_ids:
                        db.table("broadcast_dispatch_assignments").update({
                            "sent_count": mailing.get("sent_count", 0),
                            "failed_count": mailing.get("failed_count", 0),
                            "last_poll_at": _utcnow(),
                        }).eq("id", tracked_ids[mailing_id]).execute()
                        found += 1
                if len(results) < 100:
                    break  # no more pages
                page += 1
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
                        "last_meta_check_at": _utcnow(),
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
    """Leader-elected loop — only one worker runs monitor_tick at a time."""
    import os
    lock_key = "broadcast:monitor_lock"
    worker_id = str(os.getpid())
    logger.info(f"Monitor loop standby — worker {worker_id}")

    while True:
        try:
            current = await redis_client.get(lock_key)
            current_val = current.decode() if isinstance(current, bytes) else current

            if current_val == worker_id:
                # We are leader — refresh TTL and run
                await redis_client.expire(lock_key, POLL_INTERVAL * 3)
                await monitor_tick(redis_client)
            elif current_val is None:
                # No leader — try to claim
                acquired = await redis_client.set(lock_key, worker_id, ex=POLL_INTERVAL * 3, nx=True)
                if acquired:
                    logger.info(f"Monitor leader elected: worker {worker_id}")
                    await monitor_tick(redis_client)
        except Exception as e:
            logger.exception(f"Monitor tick error: {e}")
        await asyncio.sleep(POLL_INTERVAL)
