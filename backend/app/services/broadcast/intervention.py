from __future__ import annotations

import json
from datetime import datetime, timezone

from supabase import Client

from app.services.broadcast.vendeai_client import VendeAIClient


async def evaluate_and_intervene(
    db: Client,
    owner_id: str,
    vendeai: VendeAIClient,
) -> list[dict]:
    """
    Check active assignments for intervention triggers.
    Returns list of alerts created.
    """
    alerts_created = []
    now = datetime.now(timezone.utc)
    window_hour = now.strftime("%Y%m%d%H")

    # Load active assignments with their dispatch + number info
    assignments_resp = db.table("broadcast_dispatch_assignments") \
        .select("*, broadcast_dispatches!inner(owner_id, status), broadcast_numbers!inner(quality_rating, is_paused)") \
        .eq("owner_id", owner_id) \
        .in_("status", ["running", "scheduled"]) \
        .execute()

    for asn in (assignments_resp.data or []):
        dispatch_status = asn.get("broadcast_dispatches", {}).get("status")
        if dispatch_status not in ("running",):
            continue

        phone_id = asn["phone_id"]
        dispatch_id = asn["dispatch_id"]
        sent = asn.get("sent_count", 0)
        failed = asn.get("failed_count", 0)
        quality = asn.get("broadcast_numbers", {}).get("quality_rating", "UNKNOWN")
        mailing_id = asn.get("vendeai_mailing_id")

        # Trigger 1: quality RED
        if quality == "RED":
            alert = await _create_alert(
                db, owner_id, dispatch_id, phone_id,
                "quality_drop", "critical",
                f"Número {phone_id} caiu para RED — pausando disparo",
                window_hour,
            )
            if alert:
                alerts_created.append(alert)
                if mailing_id:
                    try:
                        await vendeai.pause(mailing_id)
                    except Exception:
                        pass
                db.table("broadcast_dispatch_assignments").update({
                    "status": "paused"
                }).eq("id", asn["id"]).execute()
                db.table("broadcast_numbers").update({
                    "is_paused": True
                }).eq("owner_id", owner_id).eq("phone_id", phone_id).execute()
                # Failover
                await _attempt_failover(db, owner_id, dispatch_id, phone_id, asn)

        # Trigger 2: failed spike (>10%)
        elif sent > 0 and failed / sent > 0.10:
            alert = await _create_alert(
                db, owner_id, dispatch_id, phone_id,
                "failed_spike", "critical",
                f"Número {phone_id}: taxa de falha {failed}/{sent} ({failed/sent*100:.0f}%) — pausando",
                window_hour,
            )
            if alert:
                alerts_created.append(alert)
                if mailing_id:
                    try:
                        await vendeai.pause(mailing_id)
                    except Exception:
                        pass
                db.table("broadcast_dispatch_assignments").update({
                    "status": "paused"
                }).eq("id", asn["id"]).execute()

        # Trigger 3: quality YELLOW — warn only
        elif quality == "YELLOW":
            alert = await _create_alert(
                db, owner_id, dispatch_id, phone_id,
                "quality_drop", "warn",
                f"Número {phone_id} em YELLOW — monitorando",
                window_hour,
            )
            if alert:
                alerts_created.append(alert)

    return alerts_created


async def _create_alert(
    db: Client,
    owner_id: str,
    dispatch_id: str,
    phone_id: str,
    alert_type: str,
    severity: str,
    message: str,
    window_hour: str,
    action_taken: str = "paused",
) -> dict | None:
    action_id = f"{dispatch_id}:{phone_id}:{alert_type}:{window_hour}"
    try:
        resp = db.table("broadcast_alerts").insert({
            "owner_id": owner_id,
            "dispatch_id": dispatch_id,
            "phone_id": phone_id,
            "alert_type": alert_type,
            "severity": severity,
            "message": message,
            "action_taken": action_taken,
            "action_id": action_id,
        }).execute()
        return resp.data[0] if resp.data else None
    except Exception:
        return None  # UNIQUE constraint — already handled this hour


async def _attempt_failover(
    db: Client,
    owner_id: str,
    dispatch_id: str,
    failed_phone_id: str,
    failed_asn: dict,
) -> None:
    """
    Failover: record remaining leads against a backup number so the operator
    can re-dispatch via the UI. We cannot automatically re-dispatch because
    the original CSV bytes are no longer in Redis after the first dispatch.
    Creates a 'failover' assignment with status='paused' so CampaignHistoryList
    shows it and the alert feed explains what happened.
    """
    remaining = failed_asn.get("planned_count", 0) - (failed_asn.get("sent_count", 0) or 0)
    if remaining <= 0:
        return

    numbers_resp = db.table("broadcast_numbers") \
        .select("phone_id, daily_limit, chatwoot_inbox_id") \
        .eq("owner_id", owner_id) \
        .eq("quality_rating", "GREEN") \
        .eq("is_paused", False) \
        .eq("chatwoot_connected", True) \
        .neq("phone_id", failed_phone_id) \
        .order("daily_limit", desc=True) \
        .limit(1) \
        .execute()

    if not numbers_resp.data:
        # No eligible backup — create alert so operator knows
        try:
            db.table("broadcast_alerts").insert({
                "owner_id": owner_id,
                "dispatch_id": dispatch_id,
                "phone_id": failed_phone_id,
                "alert_type": "failover_no_backup",
                "severity": "critical",
                "message": f"{remaining} leads sem failover — nenhum número GREEN disponível",
                "action_taken": "none",
                "action_id": f"{dispatch_id}:{failed_phone_id}:failover_no_backup",
            }).execute()
        except Exception:
            pass
        return

    failover_num = numbers_resp.data[0]
    failover_phone = failover_num["phone_id"]

    # Copy template/inbox from the failed assignment so the UI has enough context
    existing = db.table("broadcast_dispatch_assignments") \
        .select("id, planned_count") \
        .eq("dispatch_id", dispatch_id) \
        .eq("phone_id", failover_phone) \
        .execute()

    if existing.data:
        asn_id = existing.data[0]["id"]
        new_planned = (existing.data[0]["planned_count"] or 0) + remaining
        db.table("broadcast_dispatch_assignments").update({
            "planned_count": new_planned
        }).eq("id", asn_id).execute()
    else:
        db.table("broadcast_dispatch_assignments").insert({
            "dispatch_id": dispatch_id,
            "owner_id": owner_id,
            "phone_id": failover_phone,
            "planned_count": remaining,
            "status": "paused",
            "template_id": failed_asn.get("template_id", ""),
            "inbox_id": failover_num.get("chatwoot_inbox_id") or failed_asn.get("inbox_id", ""),
            "display_phone": failover_phone[-10:],
            "quality_at_start": "GREEN",
        }).execute()

    # Alert operator to re-dispatch the failover slice manually
    try:
        db.table("broadcast_alerts").insert({
            "owner_id": owner_id,
            "dispatch_id": dispatch_id,
            "phone_id": failover_phone,
            "alert_type": "failover_pending",
            "severity": "warn",
            "message": f"{remaining} leads em espera no failover ({failover_phone[-10:]}) — re-disparo manual necessário",
            "action_taken": "failover_created",
            "action_id": f"{dispatch_id}:{failed_phone_id}:failover_pending",
        }).execute()
    except Exception:
        pass
