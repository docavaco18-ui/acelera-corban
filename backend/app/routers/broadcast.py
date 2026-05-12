from __future__ import annotations

import io
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from app.config import settings
from app.credentials.crypto import decrypt, encrypt, safe_decrypt
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
    email: Optional[str] = None
    password: Optional[str] = None
    meta_token: Optional[str] = None


@router.post("/credentials")
async def save_credentials(
    body: CredentialsIn,
    user_id: str = Depends(_get_user_id),
):
    """Partial update — campos vazios mantém valor existente.
    Aceita strings vazias e None como 'não alterar'."""
    db = get_db()

    # Build patch only with fields that have actual values
    patch: dict = {"owner_id": user_id}
    if body.email and body.email.strip():
        patch["email_enc"] = encrypt(body.email.strip())
    if body.password and body.password.strip():
        patch["password_enc"] = encrypt(body.password.strip())
    if body.meta_token and body.meta_token.strip():
        patch["meta_token_enc"] = encrypt(body.meta_token.strip())

    if len(patch) == 1:  # só owner_id, sem nada pra atualizar
        raise HTTPException(400, "Nenhum campo preenchido")

    # Check if row exists — upsert if new, else update only the patched fields
    existing = db.table("vendeai_settings").select("owner_id").eq("owner_id", user_id).execute()
    if existing.data:
        # Update partial — only fields in patch
        patch.pop("owner_id")
        db.table("vendeai_settings").update(patch).eq("owner_id", user_id).execute()
    else:
        # First insert — email and password required
        if "email_enc" not in patch or "password_enc" not in patch:
            raise HTTPException(400, "Email e senha obrigatórios na primeira gravação")
        db.table("vendeai_settings").insert(patch).execute()

    return {"ok": True, "updated_fields": [k for k in patch if k != "owner_id"]}


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


class WabaIdsIn(BaseModel):
    waba_ids: list[str]


@router.post("/waba-ids")
async def save_waba_ids(body: WabaIdsIn, user_id: str = Depends(_get_user_id)):
    db = get_db()
    db.table("vendeai_settings").upsert({
        "owner_id": user_id,
        "waba_ids": body.waba_ids,
    }, on_conflict="owner_id").execute()
    return {"ok": True, "waba_ids": body.waba_ids}


@router.get("/waba-ids")
async def get_waba_ids(user_id: str = Depends(_get_user_id)):
    db = get_db()
    resp = db.table("vendeai_settings").select("waba_ids").eq("owner_id", user_id).execute()
    if not resp.data:
        return {"waba_ids": []}
    return {"waba_ids": resp.data[0].get("waba_ids") or []}


@router.post("/numbers/refresh")
async def refresh_numbers(user_id: str = Depends(_get_user_id)):
    db = get_db()
    creds = db.table("vendeai_settings").select("*").eq("owner_id", user_id).single().execute()
    if not creds.data:
        raise HTTPException(400, "Configure credenciais primeiro")

    meta_token = safe_decrypt(creds.data.get("meta_token_enc"))
    vendeai_email = safe_decrypt(creds.data.get("email_enc"))
    vendeai_pass = safe_decrypt(creds.data.get("password_enc"))
    account_id = creds.data.get("account_id")
    crm_token = safe_decrypt(creds.data.get("crm_token_enc"))
    waba_ids: list[str] = creds.data.get("waba_ids") or []

    if not meta_token:
        raise HTTPException(400, "Token Meta não configurado")
    if not waba_ids:
        raise HTTPException(400, "Nenhum WABA ID configurado")

    # 1. Fetch VendeAI/Chatwoot inboxes — build lookup: last10digits → inbox_id
    chatwoot_map: dict[str, str] = {}
    try:
        va = VendeAIClient(vendeai_email, vendeai_pass, account_id=account_id, crm_token=crm_token)
        inboxes = await va.list_inboxes()
        for inbox in inboxes:
            raw_phone = inbox.get("phone_number") or inbox.get("phone") or ""
            digits = "".join(c for c in raw_phone if c.isdigit())
            if len(digits) >= 8:
                key = digits[-10:]
                chatwoot_map[key] = str(inbox.get("id") or inbox.get("inbox_id") or "")
            # also index by inbox_id directly for fallback matching
            inbox_id_str = str(inbox.get("id") or inbox.get("inbox_id") or "")
            if inbox_id_str:
                chatwoot_map[f"__id__{inbox_id_str}"] = inbox_id_str
    except Exception:
        pass  # Chatwoot down não bloqueia refresh Meta

    # 2. Fetch Meta numbers per WABA and cross-reference
    meta = MetaClient(meta_token)
    updated = []

    for waba_id in waba_ids:
        try:
            phones = await meta.get_all_phones(waba_id)
        except Exception:
            continue

        for p in phones:
            digits = "".join(c for c in p["display_phone"] if c.isdigit())
            suffix = digits[-10:] if len(digits) >= 10 else digits
            inbox_id = chatwoot_map.get(suffix)

            record = {
                "owner_id": user_id,
                "waba_id": waba_id,
                "phone_id": p["phone_id"],
                "display_phone": p["display_phone"],
                "quality_rating": p["quality_rating"],
                "throughput_level": p["throughput_level"],
                "messaging_tier": p["messaging_tier"],
                "daily_limit": p["daily_limit"],
                "can_send": p["can_send"],
                "name_status": p["name_status"],
                "phone_status": p["phone_status"],
                "restriction_codes": p["restriction_codes"],
                "chatwoot_connected": inbox_id is not None,
                "chatwoot_inbox_id": inbox_id,
                "last_meta_check_at": datetime.now(timezone.utc).isoformat(),
            }
            db.table("broadcast_numbers").upsert(record, on_conflict="owner_id,phone_id").execute()
            updated.append(p["phone_id"])

    return {"updated": updated, "total": len(updated), "chatwoot_inboxes_found": len(chatwoot_map)}


# ── Analyze CSV ───────────────────────────────────────────────────────────────

@router.post("/analyze")
async def analyze_csv(
    file: UploadFile = File(...),
    user_id: str = Depends(_get_user_id),
):
    db = get_db()

    csv_bytes = await file.read()
    # Strip UTF-8 BOM if present (Excel/Windows add it)
    if csv_bytes.startswith(b"\xef\xbb\xbf"):
        csv_bytes = csv_bytes[3:]
    total_leads = max(0, csv_bytes.count(b"\n") - 1)  # rough count minus header

    # Extract CSV column headers
    import csv, io
    csv_columns: list[str] = []
    try:
        first_line = csv_bytes.decode("utf-8", errors="replace").splitlines()[0].lstrip("﻿")
        for delim in [",", ";", "\t", "|"]:
            if delim in first_line:
                csv_columns = [c.strip().strip('"').lstrip("﻿") for c in first_line.split(delim)]
                break
        if not csv_columns:
            csv_columns = [first_line.strip()]
    except Exception:
        csv_columns = []

    numbers_resp = db.table("broadcast_numbers").select("*").eq("owner_id", user_id).execute()
    numbers = numbers_resp.data or []

    if not numbers:
        raise HTTPException(400, "Nenhum número cadastrado. Configure e faça refresh.")

    # Build lookup: phone_id → full number record
    numbers_by_id = {n["phone_id"]: n for n in numbers}

    numbers_input = [
        {
            "phone_id": n["phone_id"],
            "quality_rating": n.get("quality_rating", "UNKNOWN"),
            "messaging_tier": n.get("messaging_tier", "—"),
            "daily_limit": n.get("daily_limit", 0),
            "is_paused": n.get("is_paused", False),
            "can_send": n.get("can_send", "UNKNOWN"),
            "chatwoot_connected": n.get("chatwoot_connected", False),
        }
        for n in numbers
    ]

    split = await advise_split(numbers_input, total_leads, settings.anthropic_api_key)

    # Enrich assignments with display info and pre-filled inbox_id
    for asn in split.get("assignments", []):
        rec = numbers_by_id.get(asn["phone_id"], {})
        asn["display_phone"] = rec.get("display_phone", asn["phone_id"][-10:])
        asn["inbox_id"] = rec.get("chatwoot_inbox_id") or ""
        asn["can_send"] = rec.get("can_send", "UNKNOWN")
        asn["waba_id"] = rec.get("waba_id") or ""

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
    r = aioredis.from_url(settings.redis_url)
    await r.setex(f"broadcast:csv:{dispatch_id}", 3600, csv_bytes)

    return {"dispatch_id": dispatch_id, "total_leads": total_leads, "split": split, "csv_columns": csv_columns}


# ── Dispatch ──────────────────────────────────────────────────────────────────

class DispatchIn(BaseModel):
    dispatch_id: str
    assignments: list[dict]
    phone_column: str = "telefone"
    campaign_name: str = ""
    cooldown_seconds: int = 5
    skip_weekends: bool = True
    skip_night: bool = True
    dedup_window_hours: int = 24


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

    email = safe_decrypt(creds.data.get("email_enc"))
    password = safe_decrypt(creds.data.get("password_enc"))
    if not email or not password:
        raise HTTPException(400, "Credenciais VendeAI corrompidas. Re-salve em Configurações.")
    vendeai = VendeAIClient(email, password)

    r = aioredis.from_url(settings.redis_url)
    csv_bytes = await r.get(f"broadcast:csv:{body.dispatch_id}")
    if not csv_bytes:
        raise HTTPException(400, "CSV expirou. Faça upload novamente.")
    # Strip BOM defensively (in case CSV was stored before the fix)
    if csv_bytes.startswith(b"\xef\xbb\xbf"):
        csv_bytes = csv_bytes[3:]

    # Parse CSV once — slice rows per assignment so each number gets its own batch
    import csv as csv_mod
    csv_text = csv_bytes.decode("utf-8", errors="replace")
    csv_lines = csv_text.splitlines()
    header = csv_lines[0] if csv_lines else ""
    data_rows = csv_lines[1:] if len(csv_lines) > 1 else []

    def _slice_csv(rows: list[str], start: int, count: int) -> bytes:
        chunk = [header] + rows[start: start + count]
        return "\n".join(chunk).encode("utf-8")

    mailing_ids = []
    row_offset = 0
    for asn in body.assignments:
        phone_id = asn["phone_id"]
        planned = asn.get("planned_count", 0)
        inbox_id = asn.get("inbox_id", "")
        template_id = asn.get("template_id", "")

        if not inbox_id or not template_id:
            raise HTTPException(400, f"inbox_id e template_id obrigatórios para {phone_id}")

        # Each number only receives its own slice of the CSV
        slice_bytes = _slice_csv(data_rows, row_offset, planned) if planned > 0 else csv_bytes
        row_offset += planned

        variable_mappings: dict = asn.get("variable_mappings") or {}
        try:
            resp = await vendeai.dispatch_csv(
                csv_bytes=slice_bytes,
                csv_filename=dispatch.data.get("csv_filename", "leads.csv"),
                inbox_id=inbox_id,
                template_id=template_id,
                phone_column=body.phone_column,
                campaign_name=body.campaign_name,
                cooldown_seconds=body.cooldown_seconds,
                skip_weekends=body.skip_weekends,
                skip_night=body.skip_night,
                dedup_window_hours=body.dedup_window_hours,
                variable_mappings=variable_mappings or None,
            )
        except Exception as exc:
            raise HTTPException(502, f"Erro VendeAI para {phone_id}: {exc}")

        mailing_id = resp.get("id") or resp.get("mailing_id")

        # Capture quality at dispatch time
        num_rec = db.table("broadcast_numbers").select("quality_rating") \
            .eq("owner_id", user_id).eq("phone_id", phone_id).execute()
        quality_at_start = (num_rec.data[0].get("quality_rating") if num_rec.data else None)

        db.table("broadcast_dispatch_assignments").insert({
            "dispatch_id": body.dispatch_id,
            "owner_id": user_id,
            "phone_id": phone_id,
            "vendeai_mailing_id": mailing_id,
            "planned_count": planned,
            "status": "running",
            "template_id": asn.get("template_id", ""),
            "inbox_id": asn.get("inbox_id", ""),
            "variable_mappings": asn.get("variable_mappings") or {},
            "quality_at_start": quality_at_start,
            "display_phone": asn.get("display_phone", ""),
        }).execute()
        mailing_ids.append(mailing_id)

    db.table("broadcast_dispatches").update({
        "status": "running",
        "started_at": datetime.now(timezone.utc).isoformat(),
        "campaign_name": body.campaign_name,
        "phone_column": body.phone_column,
        "cooldown_seconds": body.cooldown_seconds,
        "skip_weekends": body.skip_weekends,
        "skip_night": body.skip_night,
        "dedup_window_hours": body.dedup_window_hours,
    }).eq("id", body.dispatch_id).execute()

    return {"ok": True, "mailing_ids": mailing_ids}


# ── Snapshot (bootstrap for monitoring panel) ─────────────────────────────────

@router.get("/snapshot")
async def get_snapshot(user_id: str = Depends(_get_user_id)):
    """Returns current numbers + active dispatches with assignments for monitoring bootstrap."""
    db = get_db()
    numbers = db.table("broadcast_numbers").select("*").eq("owner_id", user_id).execute()
    dispatches = db.table("broadcast_dispatches") \
        .select("*, broadcast_dispatch_assignments(*)") \
        .eq("owner_id", user_id) \
        .in_("status", ["running", "paused"]) \
        .order("created_at", desc=True) \
        .execute()
    alerts = db.table("broadcast_alerts") \
        .select("*").eq("owner_id", user_id) \
        .order("ts", desc=True).limit(20).execute()
    return {
        "numbers": numbers.data or [],
        "active_dispatches": dispatches.data or [],
        "alerts": alerts.data or [],
    }


# ── List / Detail Dispatches ──────────────────────────────────────────────────

@router.get("/dispatches")
async def list_dispatches(user_id: str = Depends(_get_user_id)):
    db = get_db()
    resp = db.table("broadcast_dispatches") \
        .select("*, broadcast_dispatch_assignments(*)") \
        .eq("owner_id", user_id) \
        .order("created_at", desc=True) \
        .limit(30) \
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
    email = safe_decrypt(creds.data.get("email_enc"))
    password = safe_decrypt(creds.data.get("password_enc"))
    if not email or not password:
        raise HTTPException(400, "Credenciais VendeAI corrompidas. Re-salve em Configurações.")
    return VendeAIClient(email, password)


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
        "finished_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", dispatch_id).eq("owner_id", user_id).execute()
    return {"ok": True}


# ── Templates ─────────────────────────────────────────────────────────────────

@router.get("/templates")
async def list_templates(user_id: str = Depends(_get_user_id)):
    db = get_db()
    creds = db.table("vendeai_settings").select("*").eq("owner_id", user_id).single().execute()
    if not creds.data:
        raise HTTPException(400, "Configure credenciais primeiro")

    meta_token = safe_decrypt(creds.data.get("meta_token_enc"))
    if not meta_token:
        raise HTTPException(400, "Token Meta não configurado ou corrompido. Re-salve em Configurações.")

    waba_ids: list[str] = creds.data.get("waba_ids") or []
    if not waba_ids:
        raise HTTPException(400, "Nenhum WABA ID configurado")

    meta = MetaClient(meta_token)
    # Return map: waba_id → list of templates (for per-number filtering in frontend)
    result: dict[str, list] = {}

    for wid in waba_ids:
        try:
            tpls = await meta.get_templates(wid)
            result[wid] = sorted([
                {
                    "id": t.get("id", ""),
                    "name": t.get("name", ""),
                    "language": t.get("language", ""),
                    "category": t.get("category", ""),
                    "variables": t.get("variables", []),
                    "body": t.get("body", ""),
                }
                for t in tpls
            ], key=lambda t: t["name"])
        except Exception:
            result[wid] = []

    return result


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
