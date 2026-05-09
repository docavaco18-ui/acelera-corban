from __future__ import annotations

import io
import uuid
from typing import Any, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from app.config import settings
from app.credentials.crypto import decrypt, encrypt
from app.database import get_db
from app.services.broadcast.claude_advisor import advise_split
from app.services.broadcast.meta_client import MetaClient
from app.services.broadcast.vendeai_client import VendeAIClient

router = APIRouter(prefix="/api/broadcast", tags=["broadcast"])
security = HTTPBearer()


def _get_user_id(credentials: HTTPAuthorizationCredentials = Depends(security)) -> str:
    db = get_db()
    try:
        resp = db.auth.get_user(credentials.credentials)
        return resp.user.id
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")


# ── Credentials ──────────────────────────────────────────────────────────────

class CredentialsIn(BaseModel):
    email: str
    password: str
    meta_token: Optional[str] = None


@router.post("/credentials")
async def save_credentials(
    body: CredentialsIn,
    user_id: str = Depends(_get_user_id),
):
    db = get_db()
    db.table("vendeai_settings").upsert({
        "owner_id": user_id,
        "email_enc": encrypt(body.email),
        "password_enc": encrypt(body.password),
        "meta_token_enc": encrypt(body.meta_token) if body.meta_token else None,
    }).execute()
    return {"ok": True}


@router.get("/credentials")
async def get_credentials_status(user_id: str = Depends(_get_user_id)):
    db = get_db()
    resp = db.table("vendeai_settings").select("owner_id").eq("owner_id", user_id).execute()
    return {"configured": bool(resp.data)}


# ── Numbers ───────────────────────────────────────────────────────────────────

@router.get("/numbers")
async def list_numbers(user_id: str = Depends(_get_user_id)):
    db = get_db()
    resp = db.table("broadcast_numbers").select("*").eq("owner_id", user_id).execute()
    return resp.data or []


@router.post("/numbers/refresh")
async def refresh_numbers(user_id: str = Depends(_get_user_id)):
    db = get_db()
    creds = db.table("vendeai_settings").select("*").eq("owner_id", user_id).single().execute()
    if not creds.data:
        raise HTTPException(400, "Configure credenciais primeiro")

    meta_token = decrypt(creds.data.get("meta_token_enc"))
    if not meta_token:
        raise HTTPException(400, "Meta token não configurado")

    vendeai_email = decrypt(creds.data.get("email_enc"))
    vendeai_pass = decrypt(creds.data.get("password_enc"))

    # Pull inboxes from VendeAI to discover phone_ids
    client = VendeAIClient(vendeai_email, vendeai_pass)
    inboxes = await client.list_inboxes()

    meta = MetaClient(meta_token)
    updated = []
    for inbox in inboxes:
        phone_id = str(inbox.get("phone_id") or inbox.get("id") or "")
        if not phone_id:
            continue
        try:
            q = await meta.get_phone_quality(phone_id)
            db.table("broadcast_numbers").upsert({
                "owner_id": user_id,
                "phone_id": phone_id,
                "display_phone": q["display_phone"] or inbox.get("inbox_phone", ""),
                "quality_rating": q["quality_rating"],
                "messaging_tier": q["messaging_tier"],
                "daily_limit": q["daily_limit"],
                "last_meta_check_at": "now()",
            }).execute()
            updated.append(phone_id)
        except Exception:
            pass

    return {"updated": updated}


# ── Analyze CSV ───────────────────────────────────────────────────────────────

@router.post("/analyze")
async def analyze_csv(
    file: UploadFile = File(...),
    user_id: str = Depends(_get_user_id),
):
    db = get_db()

    if not settings.anthropic_api_key:
        raise HTTPException(500, "ANTHROPIC_API_KEY não configurado")

    csv_bytes = await file.read()
    total_leads = max(0, csv_bytes.count(b"\n") - 1)  # rough count minus header

    numbers_resp = db.table("broadcast_numbers").select("*").eq("owner_id", user_id).execute()
    numbers = numbers_resp.data or []

    if not numbers:
        raise HTTPException(400, "Nenhum número cadastrado. Configure e faça refresh.")

    numbers_input = [
        {
            "phone_id": n["phone_id"],
            "quality_rating": n.get("quality_rating", "UNKNOWN"),
            "messaging_tier": n.get("messaging_tier", "1K"),
            "daily_limit": n.get("daily_limit", 1000),
            "is_paused": n.get("is_paused", False),
        }
        for n in numbers
    ]

    split = await advise_split(numbers_input, total_leads, settings.anthropic_api_key)

    # Store pending dispatch
    dispatch_id = str(uuid.uuid4())
    db.table("broadcast_dispatches").insert({
        "id": dispatch_id,
        "owner_id": user_id,
        "csv_filename": file.filename,
        "total_leads": total_leads,
        "claude_split_json": split,
        "status": "pending_confirm",
    }).execute()

    # Store csv bytes temporarily in Redis
    import redis as syncredis
    r = syncredis.from_url(settings.redis_url)
    r.setex(f"broadcast:csv:{dispatch_id}", 3600, csv_bytes)

    return {"dispatch_id": dispatch_id, "total_leads": total_leads, "split": split}


# ── Dispatch ──────────────────────────────────────────────────────────────────

class DispatchIn(BaseModel):
    dispatch_id: str
    assignments: list[dict]  # [{phone_id, planned_count, inbox_id, template_id}]


@router.post("/dispatch")
async def confirm_dispatch(
    body: DispatchIn,
    user_id: str = Depends(_get_user_id),
):
    db = get_db()

    dispatch = db.table("broadcast_dispatches") \
        .select("*") \
        .eq("id", body.dispatch_id) \
        .eq("owner_id", user_id) \
        .single() \
        .execute()

    if not dispatch.data:
        raise HTTPException(404, "Dispatch não encontrado")
    if dispatch.data["status"] != "pending_confirm":
        raise HTTPException(400, f"Dispatch já está em status {dispatch.data['status']}")

    creds = db.table("vendeai_settings").select("*").eq("owner_id", user_id).single().execute()
    if not creds.data:
        raise HTTPException(400, "Configure credenciais VendeAI primeiro")

    email = decrypt(creds.data["email_enc"])
    password = decrypt(creds.data["password_enc"])
    vendeai = VendeAIClient(email, password)

    import redis as syncredis
    r = syncredis.from_url(settings.redis_url)
    csv_bytes = r.get(f"broadcast:csv:{body.dispatch_id}")
    if not csv_bytes:
        raise HTTPException(400, "CSV expirou. Faça upload novamente.")

    mailing_ids = []
    for asn in body.assignments:
        phone_id = asn["phone_id"]
        planned = asn.get("planned_count", 0)
        inbox_id = asn.get("inbox_id", "")
        template_id = asn.get("template_id", "")

        if not inbox_id or not template_id:
            raise HTTPException(400, f"inbox_id e template_id obrigatórios para {phone_id}")

        resp = await vendeai.dispatch_csv(
            csv_bytes=csv_bytes,
            csv_filename=dispatch.data.get("csv_filename", "leads.csv"),
            inbox_id=inbox_id,
            template_id=template_id,
        )

        mailing_id = resp.get("id") or resp.get("mailing_id")

        db.table("broadcast_dispatch_assignments").insert({
            "dispatch_id": body.dispatch_id,
            "owner_id": user_id,
            "phone_id": phone_id,
            "vendeai_mailing_id": mailing_id,
            "planned_count": planned,
            "status": "running",
        }).execute()
        mailing_ids.append(mailing_id)

    db.table("broadcast_dispatches").update({
        "status": "running",
        "started_at": "now()",
    }).eq("id", body.dispatch_id).execute()

    return {"ok": True, "mailing_ids": mailing_ids}


# ── List / Detail Dispatches ──────────────────────────────────────────────────

@router.get("/dispatches")
async def list_dispatches(user_id: str = Depends(_get_user_id)):
    db = get_db()
    resp = db.table("broadcast_dispatches") \
        .select("*") \
        .eq("owner_id", user_id) \
        .order("created_at", desc=True) \
        .limit(20) \
        .execute()
    return resp.data or []


@router.get("/dispatches/{dispatch_id}")
async def get_dispatch(dispatch_id: str, user_id: str = Depends(_get_user_id)):
    db = get_db()
    resp = db.table("broadcast_dispatches") \
        .select("*, broadcast_dispatch_assignments(*)") \
        .eq("id", dispatch_id) \
        .eq("owner_id", user_id) \
        .single() \
        .execute()
    if not resp.data:
        raise HTTPException(404, "Dispatch não encontrado")
    return resp.data


# ── Pause / Resume / Revoke ───────────────────────────────────────────────────

async def _get_vendeai_for_user(user_id: str) -> VendeAIClient:
    db = get_db()
    creds = db.table("vendeai_settings").select("*").eq("owner_id", user_id).single().execute()
    if not creds.data:
        raise HTTPException(400, "Credenciais não configuradas")
    return VendeAIClient(decrypt(creds.data["email_enc"]), decrypt(creds.data["password_enc"]))


@router.post("/dispatches/{dispatch_id}/pause")
async def pause_dispatch(dispatch_id: str, user_id: str = Depends(_get_user_id)):
    db = get_db()
    vendeai = await _get_vendeai_for_user(user_id)
    asns = db.table("broadcast_dispatch_assignments") \
        .select("vendeai_mailing_id") \
        .eq("dispatch_id", dispatch_id) \
        .eq("owner_id", user_id) \
        .eq("status", "running") \
        .execute()
    for asn in (asns.data or []):
        if asn.get("vendeai_mailing_id"):
            try:
                await vendeai.pause(asn["vendeai_mailing_id"])
            except Exception:
                pass
    db.table("broadcast_dispatch_assignments").update({"status": "paused"}) \
        .eq("dispatch_id", dispatch_id).eq("owner_id", user_id).execute()
    db.table("broadcast_dispatches").update({"status": "paused"}) \
        .eq("id", dispatch_id).eq("owner_id", user_id).execute()
    return {"ok": True}


@router.post("/dispatches/{dispatch_id}/resume")
async def resume_dispatch(dispatch_id: str, user_id: str = Depends(_get_user_id)):
    db = get_db()
    vendeai = await _get_vendeai_for_user(user_id)
    asns = db.table("broadcast_dispatch_assignments") \
        .select("vendeai_mailing_id") \
        .eq("dispatch_id", dispatch_id) \
        .eq("owner_id", user_id) \
        .eq("status", "paused") \
        .execute()
    for asn in (asns.data or []):
        if asn.get("vendeai_mailing_id"):
            try:
                await vendeai.resume(asn["vendeai_mailing_id"])
            except Exception:
                pass
    db.table("broadcast_dispatch_assignments").update({"status": "running"}) \
        .eq("dispatch_id", dispatch_id).eq("owner_id", user_id).execute()
    db.table("broadcast_dispatches").update({"status": "running"}) \
        .eq("id", dispatch_id).eq("owner_id", user_id).execute()
    return {"ok": True}


@router.post("/dispatches/{dispatch_id}/revoke")
async def revoke_dispatch(dispatch_id: str, user_id: str = Depends(_get_user_id)):
    db = get_db()
    vendeai = await _get_vendeai_for_user(user_id)
    asns = db.table("broadcast_dispatch_assignments") \
        .select("vendeai_mailing_id") \
        .eq("dispatch_id", dispatch_id) \
        .eq("owner_id", user_id) \
        .execute()
    for asn in (asns.data or []):
        if asn.get("vendeai_mailing_id"):
            try:
                await vendeai.cancel(asn["vendeai_mailing_id"])
            except Exception:
                pass
    db.table("broadcast_dispatch_assignments").update({"status": "failed"}) \
        .eq("dispatch_id", dispatch_id).eq("owner_id", user_id).execute()
    db.table("broadcast_dispatches").update({
        "status": "revoked",
        "finished_at": "now()",
    }).eq("id", dispatch_id).eq("owner_id", user_id).execute()
    return {"ok": True}


# ── Analytics + Alerts ────────────────────────────────────────────────────────

@router.get("/analytics")
async def get_analytics(user_id: str = Depends(_get_user_id)):
    db = get_db()
    asns = db.table("broadcast_dispatch_assignments") \
        .select("phone_id, sent_count, failed_count, open_count, converted_count") \
        .eq("owner_id", user_id) \
        .execute()
    by_phone: dict[str, Any] = {}
    for a in (asns.data or []):
        p = a["phone_id"]
        if p not in by_phone:
            by_phone[p] = {"sent": 0, "failed": 0, "open": 0, "converted": 0}
        by_phone[p]["sent"] += a.get("sent_count", 0)
        by_phone[p]["failed"] += a.get("failed_count", 0)
        by_phone[p]["open"] += a.get("open_count", 0)
        by_phone[p]["converted"] += a.get("converted_count", 0)
    return [{"phone_id": k, **v} for k, v in by_phone.items()]


@router.get("/alerts")
async def list_alerts(user_id: str = Depends(_get_user_id)):
    db = get_db()
    resp = db.table("broadcast_alerts") \
        .select("*") \
        .eq("owner_id", user_id) \
        .order("ts", desc=True) \
        .limit(50) \
        .execute()
    return resp.data or []
