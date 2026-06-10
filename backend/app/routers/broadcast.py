from __future__ import annotations

import asyncio
import io
import logging
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

log = logging.getLogger("acelera.broadcast")

import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from app.config import settings
from app.credentials.crypto import encrypt, safe_decrypt
from app.database import get_db
from app.services.broadcast.assignment_validator import validate_vendeai_assignments
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
    account_id: Optional[str] = None     # Chatwoot/VendeAI account ID
    crm_token: Optional[str] = None      # CRM access token (Chatwoot)


@router.post("/credentials")
async def save_credentials(
    body: CredentialsIn,
    user_id: str = Depends(_get_user_id),
):
    """Partial update — campos vazios mantém valor existente.
    Aceita strings vazias e None como 'não alterar'."""
    db = get_db()

    patch: dict = {"owner_id": user_id}
    if body.email and body.email.strip():
        patch["email_enc"] = encrypt(body.email.strip())
    if body.password and body.password.strip():
        patch["password_enc"] = encrypt(body.password.strip())
    if body.meta_token and body.meta_token.strip():
        patch["meta_token_enc"] = encrypt(body.meta_token.strip())
    if body.account_id and body.account_id.strip():
        patch["account_id"] = body.account_id.strip()
    if body.crm_token and body.crm_token.strip():
        patch["crm_token_enc"] = encrypt(body.crm_token.strip())

    if len(patch) == 1:
        raise HTTPException(400, "Nenhum campo preenchido")

    existing = db.table("vendeai_settings").select("owner_id").eq("owner_id", user_id).execute()
    if existing.data:
        patch.pop("owner_id")
        db.table("vendeai_settings").update(patch).eq("owner_id", user_id).execute()
    else:
        if "email_enc" not in patch or "password_enc" not in patch:
            raise HTTPException(400, "Email e senha obrigatórios na primeira gravação")
        db.table("vendeai_settings").insert(patch).execute()

    return {"ok": True, "updated_fields": [k for k in patch if k != "owner_id"]}


@router.get("/credentials")
async def get_credentials_status(user_id: str = Depends(_get_user_id)):
    db = get_db()
    resp = db.table("vendeai_settings").select("*").eq("owner_id", user_id).execute()
    if not resp.data:
        return {"configured": False, "meta_configured": False, "waba_ids": [], "account_id": None, "crm_token_configured": False, "email": None}
    row = resp.data[0]
    # Email decifrado (identifier, não secret) — permite pré-preencher form pra UX clara após reload.
    # Senha + tokens NUNCA retornados (security).
    email_plain = safe_decrypt(row.get("email_enc") or "") or None
    return {
        "configured": bool(row.get("email_enc")),
        "meta_configured": bool(row.get("meta_token_enc")),
        "waba_ids": row.get("waba_ids") or [],
        "account_id": row.get("account_id"),
        "crm_token_configured": bool(row.get("crm_token_enc")),
        "email": email_plain,
    }


# ── Numbers ───────────────────────────────────────────────────────────────────

@router.get("/numbers")
async def list_numbers(user_id: str = Depends(_get_user_id)):
    db = get_db()
    resp = db.table("broadcast_numbers").select("*").eq("owner_id", user_id).execute()
    return resp.data or []


@router.post("/numbers/{phone_id}/resume")
async def resume_number(phone_id: str, user_id: str = Depends(_get_user_id)):
    """Un-pause a number that was auto-paused by the intervention loop."""
    db = get_db()
    existing = db.table("broadcast_numbers") \
        .select("phone_id") \
        .eq("owner_id", user_id) \
        .eq("phone_id", phone_id) \
        .execute()
    if not existing.data:
        raise HTTPException(404, "Número não encontrado")
    db.table("broadcast_numbers").update({"is_paused": False}) \
        .eq("owner_id", user_id).eq("phone_id", phone_id).execute()
    return {"ok": True, "phone_id": phone_id}


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
    """Pattern Aesir: Meta primeiro (independente do CRM), erros não-fatais, response sempre 200.

    Devolve `chatwoot_error` e `meta_error` no JSON pra UI surfacar sem matar a tela.
    Números Meta sem match Chatwoot ainda são salvos (chatwoot_connected=False).
    """
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
        raise HTTPException(400, "Configure o token Meta antes de sincronizar.")

    # ── Step 1: Meta discovery (independente do CRM) ─────────────────────────
    meta_error: str | None = None
    meta_phones_list: list[dict] = []
    meta = MetaClient(meta_token)
    try:
        if waba_ids:
            async def _safe_phones(wid: str):
                try:
                    waba_info = await meta.get_waba_info(wid)
                    phones = await meta.get_all_phones(wid)
                    for p in phones:
                        p["waba_name"] = waba_info.get("name", "")
                        p["account_review_status"] = waba_info.get("account_review_status", "UNKNOWN")
                        p["business_verification_status"] = waba_info.get("business_verification_status", "unknown")
                        p["waba_currency"] = waba_info.get("currency", "")
                        p["waba_country"] = waba_info.get("country", "")
                    return phones
                except Exception:
                    return []
            results = await asyncio.gather(*[_safe_phones(w) for w in waba_ids])
            for phones in results:
                meta_phones_list.extend(phones)
        else:
            meta_phones_list = await meta.get_all_phones_auto()
    except Exception as e:
        meta_error = str(e)

    # ── Step 2: Chatwoot/VendeAI inboxes (não-fatal) ─────────────────────────
    chatwoot_map: dict[str, str] = {}
    chatwoot_error: str | None = None
    if vendeai_email and vendeai_pass:
        try:
            va = VendeAIClient(vendeai_email, vendeai_pass, account_id=account_id, crm_token=crm_token)
            inboxes = await va.list_inboxes()
            for inbox in inboxes:
                raw_phone = inbox.get("phone_number") or inbox.get("phone") or ""
                digits = "".join(c for c in raw_phone if c.isdigit())
                if len(digits) >= 8:
                    key = digits[-10:]
                    chatwoot_map[key] = str(inbox.get("id") or inbox.get("inbox_id") or "")
        except Exception as e:
            chatwoot_error = str(e)

    # ── Step 3: Upsert each Meta phone (com ou sem match Chatwoot) ───────────
    now_iso = datetime.now(timezone.utc).isoformat()
    updated: list[str] = []

    for p in meta_phones_list:
        digits = "".join(c for c in (p.get("display_phone") or "") if c.isdigit())
        suffix = digits[-10:] if len(digits) >= 10 else digits
        inbox_id = chatwoot_map.get(suffix)

        record = {
            "owner_id": user_id,
            "waba_id": p.get("waba_id") or "",
            "phone_id": p.get("phone_id") or "",
            "display_phone": p.get("display_phone") or "",
            "quality_rating": p.get("quality_rating", "UNKNOWN"),
            "throughput_level": p.get("throughput_level"),
            "messaging_tier": p.get("messaging_tier"),
            "daily_limit": p.get("daily_limit") or 500,
            "can_send": p.get("can_send", "UNKNOWN"),
            "name_status": p.get("name_status"),
            "phone_status": p.get("phone_status"),
            "restriction_codes": p.get("restriction_codes") or [],
            "verified_name": p.get("verified_name"),
            "account_mode": p.get("account_mode"),
            "restrictions": p.get("restrictions") or [],
            "additional_info": p.get("additional_info") or [],
            "has_payment_issue": p.get("has_payment_issue", False),
            "display_name_pending": p.get("display_name_pending", False),
            "waba_name": p.get("waba_name"),
            "account_review_status": p.get("account_review_status"),
            "business_verification_status": p.get("business_verification_status"),
            "waba_currency": p.get("waba_currency"),
            "waba_country": p.get("waba_country"),
            "chatwoot_connected": inbox_id is not None,
            "chatwoot_inbox_id": inbox_id,
            "last_meta_check_at": now_iso,
            "quality_updated_at": now_iso,
        }
        try:
            db.table("broadcast_numbers").upsert(record, on_conflict="owner_id,phone_id").execute()
            updated.append(p.get("phone_id") or "")
        except Exception:
            pass  # uma falha não mata os outros

    return {
        "ok": True,
        "updated": updated,
        "total": len(updated),
        "meta_total": len(meta_phones_list),
        "chatwoot_matched": sum(1 for p in meta_phones_list
                                if chatwoot_map.get(("".join(c for c in (p.get("display_phone") or "") if c.isdigit()))[-10:])),
        "chatwoot_inboxes_found": len(chatwoot_map),
        "meta_error": meta_error,
        "chatwoot_error": chatwoot_error,
    }


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
    # Count data lines: splitlines handles no-trailing-newline; skip header + blanks
    _all_lines = [l for l in csv_bytes.decode("utf-8", errors="replace").splitlines() if l.strip()]
    total_leads = max(0, len(_all_lines) - 1)

    # Extract CSV column headers
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

    # Store csv bytes temporarily in Redis — rollback DB record if Redis is unavailable
    try:
        async with aioredis.from_url(settings.redis_url, socket_connect_timeout=5) as r:
            await r.setex(f"broadcast:csv:{dispatch_id}", 3600, csv_bytes)
    except Exception as redis_err:
        db.table("broadcast_dispatches").delete().eq("id", dispatch_id).eq("owner_id", user_id).execute()
        raise HTTPException(503, f"Serviço de cache indisponível. Tente novamente em instantes. ({type(redis_err).__name__})")

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
    # Bloqueia disparo se sum(planned_count) != total_leads. Default false (seguro).
    # UI pode mandar true se operador conscientemente aceita disparo parcial.
    allow_partial: bool = False


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
    vendeai = VendeAIClient(
        email, password,
        account_id=creds.data.get("account_id"),
        crm_token=safe_decrypt(creds.data.get("crm_token_enc") or ""),
    )

    async with aioredis.from_url(settings.redis_url) as r:
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

    # ── Server-side validation against DB (no tenant tampering, no partial by default) ──
    total_leads_for_dispatch = int(dispatch.data.get("total_leads") or 0)
    assigned_count, unassigned_count = validate_vendeai_assignments(
        db, user_id, body.assignments, total_leads_for_dispatch, allow_partial=body.allow_partial
    )

    dispatch_errors: list[str] = []
    mailing_ids = []
    row_offset = 0
    # Prevent double-submit: mark dispatching only after pre-validation passes
    db.table("broadcast_dispatches").update({"status": "dispatching"}).eq("id", body.dispatch_id).eq("owner_id", user_id).execute()
    for asn in body.assignments:
        phone_id = asn["phone_id"]
        planned = int(asn.get("planned_count") or 0)
        inbox_id = asn.get("inbox_id", "")
        template_id = asn.get("template_id", "")

        # Each number only receives its own slice of the CSV
        if planned <= 0:
            continue
        slice_bytes = _slice_csv(data_rows, row_offset, planned)
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
            dispatch_errors.append(f"{phone_id}: {exc}")
            # Persist error assignment so monitor shows the affected leads
            try:
                db.table("broadcast_dispatch_assignments").insert({
                    "dispatch_id": body.dispatch_id,
                    "owner_id": user_id,
                    "phone_id": phone_id,
                    "planned_count": planned,
                    "status": "error",
                    "template_id": asn.get("template_id", ""),
                    "inbox_id": asn.get("inbox_id", ""),
                    "display_phone": asn.get("display_phone", ""),
                }).execute()
            except Exception:
                pass
            continue

        mailing_id = (
            resp.get("id")
            or resp.get("mailing_id")
            or (resp.get("mailing") or {}).get("id")
            or (resp[0].get("id") if isinstance(resp, list) and resp else None)
        )

        # Fallback: VendeAI response didn't include mailing id — find it by inbox_phone + recency
        if not mailing_id:
            try:
                num_resp = db.table("broadcast_numbers").select("display_phone") \
                    .eq("owner_id", user_id).eq("phone_id", phone_id).execute()
                display_phone = num_resp.data[0].get("display_phone", "") if num_resp.data else ""
                display_digits = re.sub(r"\D", "", display_phone)
                cutoff = (datetime.now(timezone.utc) - timedelta(minutes=3)).isoformat()
                ml_data = await vendeai.list_mailings(page=1, page_size=5)
                for m in ml_data.get("results", []):
                    inbox_digits = re.sub(r"\D", "", m.get("inbox_phone", ""))
                    if inbox_digits == display_digits and m.get("created_at", "") >= cutoff:
                        mailing_id = str(m["id"])
                        break
            except Exception:
                pass

        # Capture quality at dispatch time
        num_rec = db.table("broadcast_numbers").select("quality_rating") \
            .eq("owner_id", user_id).eq("phone_id", phone_id).execute()
        quality_at_start = (num_rec.data[0].get("quality_rating") if num_rec.data else None)

        asn_insert = db.table("broadcast_dispatch_assignments").insert({
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

        # Fatia 1 — persist per-recipient rows for funnel analytics.
        # Best-effort: failure here must NOT abort dispatch.
        try:
            assignment_id = (asn_insert.data[0]["id"] if asn_insert.data else None)
            import io
            slice_text = slice_bytes.decode("utf-8", errors="replace")
            if slice_text.startswith("﻿"):
                slice_text = slice_text[1:]
            reader = csv_mod.DictReader(io.StringIO(slice_text))
            var_cols = set(((variable_mappings or {}).values())) if variable_mappings else set()
            keep_cols = {body.phone_column, *var_cols}
            recipients_rows: list[dict] = []
            for idx, row in enumerate(reader):
                phone_raw = (row.get(body.phone_column) or "").strip()
                if not phone_raw:
                    continue
                phone_norm = re.sub(r"\D", "", phone_raw)
                payload = {k: v for k, v in row.items() if k in keep_cols and k != body.phone_column}
                name = (row.get("nome") or row.get("name") or row.get("Nome") or "").strip() or None
                recipients_rows.append({
                    "owner_id": user_id,
                    "dispatch_id": body.dispatch_id,
                    "assignment_id": assignment_id,
                    "phone_id": phone_id,
                    "display_phone": asn.get("display_phone") or "",
                    "recipient_phone": phone_norm,
                    "recipient_name": name,
                    "csv_row_index": idx,
                    "csv_payload": payload,
                    "template_id": template_id,
                    "provider": "vendeai",
                    "provider_mailing_id": mailing_id,
                    "status": "queued",
                })
            BATCH = 200
            for i in range(0, len(recipients_rows), BATCH):
                db.table("broadcast_recipients").insert(recipients_rows[i:i + BATCH]).execute()
        except Exception as rec_exc:
            log.warning("[broadcast] recipients insertion failed phone_id=%s: %s", phone_id, rec_exc)

    if mailing_ids and dispatch_errors:
        final_status = "partial_error"
    elif mailing_ids:
        final_status = "running"
    else:
        final_status = "error"
    db.table("broadcast_dispatches").update({
        "status": final_status,
        "started_at": datetime.now(timezone.utc).isoformat(),
        "campaign_name": body.campaign_name,
        "phone_column": body.phone_column,
        "cooldown_seconds": body.cooldown_seconds,
        "skip_weekends": body.skip_weekends,
        "skip_night": body.skip_night,
        "dedup_window_hours": body.dedup_window_hours,
    }).eq("id", body.dispatch_id).eq("owner_id", user_id).execute()

    if dispatch_errors and not mailing_ids:
        raise HTTPException(502, f"Nenhum disparo iniciado. Erros: {'; '.join(dispatch_errors)}")

    return {
        "ok": True,
        "mailing_ids": mailing_ids,
        "errors": dispatch_errors,
        "assigned_count": assigned_count,
        "unassigned_count": unassigned_count,
        "partial": bool(dispatch_errors and mailing_ids),
    }


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

    # Compute sent_today per phone_id from all assignments today (no DB column needed)
    today = datetime.now(timezone.utc).date().isoformat()
    today_asns = db.table("broadcast_dispatch_assignments") \
        .select("phone_id, sent_count") \
        .eq("owner_id", user_id) \
        .gte("created_at", today) \
        .execute()
    sent_today: dict[str, int] = {}
    for row in (today_asns.data or []):
        pid = row["phone_id"]
        sent_today[pid] = sent_today.get(pid, 0) + (row.get("sent_count") or 0)

    numbers_data = numbers.data or []
    for num in numbers_data:
        num["sent_today"] = sent_today.get(num["phone_id"], 0)

    return {
        "numbers": numbers_data,
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


# ── Fatia 1 — Real per-campaign metrics ───────────────────────────────────────

@router.get("/dispatches/{dispatch_id}/metrics")
async def get_dispatch_metrics(dispatch_id: str, user_id: str = Depends(_get_user_id)):
    """Real campaign funnel.

    Honest about data sources:
    - sent/failed → from VendeAI aggregate (broadcast_dispatch_assignments)
    - delivered/read/replied/converted → from broadcast_recipients per-row (only populated
      once Chatwoot/webhook integrations land — until then these are 0 with
      has_*_data=False so the UI can show 'sem dados ainda' instead of fake zeros)
    """
    db = get_db()
    head = db.table("broadcast_dispatches") \
        .select("id, total_leads, status, broadcast_dispatch_assignments(planned_count,sent_count,failed_count,open_count,converted_count)") \
        .eq("id", dispatch_id) \
        .eq("owner_id", user_id) \
        .single() \
        .execute()
    if not head.data:
        raise HTTPException(404, "Dispatch não encontrado")

    asns = head.data.get("broadcast_dispatch_assignments") or []
    sent_aggregate = sum((a.get("sent_count") or 0) for a in asns)
    failed_aggregate = sum((a.get("failed_count") or 0) for a in asns)
    planned_aggregate = sum((a.get("planned_count") or 0) for a in asns)

    # Per-recipient status counts (fatia 1: status="queued" inserted; transitions pending).
    counts: dict[str, int] = {}
    _RECIPIENTS_LIMIT = 50000
    rec_rows = db.table("broadcast_recipients") \
        .select("status") \
        .eq("owner_id", user_id) \
        .eq("dispatch_id", dispatch_id) \
        .limit(_RECIPIENTS_LIMIT) \
        .execute()
    for r in (rec_rows.data or []):
        counts[r["status"]] = counts.get(r["status"], 0) + 1
    total_recipients = sum(counts.values())
    recipients_truncated = len(rec_rows.data or []) >= _RECIPIENTS_LIMIT

    delivered = (counts.get("delivered", 0) + counts.get("read", 0)
                 + counts.get("replied", 0) + counts.get("converted", 0))
    read = counts.get("read", 0) + counts.get("replied", 0) + counts.get("converted", 0)
    replied = counts.get("replied", 0) + counts.get("converted", 0)
    converted = counts.get("converted", 0)

    return {
        "dispatch_id": dispatch_id,
        "total_recipients": total_recipients or planned_aggregate,
        "planned_count": planned_aggregate,
        "queued_count": counts.get("queued", 0),
        "sent_count": sent_aggregate,
        "failed_count": failed_aggregate,
        "delivered_count": delivered,
        "read_count": read,
        "reply_count": replied,
        "conversion_count": converted,
        # Honesty flags — UI renders 'sem dados ainda' when False.
        "has_per_recipient_data": total_recipients > 0,
        "has_delivered_data": delivered > 0,
        "has_read_data": read > 0,
        "has_reply_data": replied > 0,
        "has_conversion_data": converted > 0,
        "recipients_truncated": recipients_truncated,
    }


@router.get("/dispatches/{dispatch_id}/recipients")
async def list_dispatch_recipients(
    dispatch_id: str,
    status: str | None = None,
    phone_id: str | None = None,
    q: str | None = None,
    limit: int = 100,
    offset: int = 0,
    user_id: str = Depends(_get_user_id),
):
    db = get_db()
    head = db.table("broadcast_dispatches").select("id").eq("id", dispatch_id).eq("owner_id", user_id).single().execute()
    if not head.data:
        raise HTTPException(404, "Dispatch não encontrado")
    query = db.table("broadcast_recipients") \
        .select("id,recipient_phone,recipient_name,csv_row_index,status,phone_id,display_phone,template_id,sent_at,delivered_at,read_at,failed_at,first_reply_at,converted_at,conversion_label,failure_reason") \
        .eq("owner_id", user_id) \
        .eq("dispatch_id", dispatch_id)
    if status:
        query = query.eq("status", status)
    if phone_id:
        query = query.eq("phone_id", phone_id)
    if q:
        query = query.ilike("recipient_phone", f"%{q}%")
    resp = query.order("csv_row_index").range(offset, offset + max(1, min(limit, 500)) - 1).execute()
    return {"recipients": resp.data or [], "limit": limit, "offset": offset}


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
    return VendeAIClient(
        email, password,
        account_id=creds.data.get("account_id"),
        crm_token=safe_decrypt(creds.data.get("crm_token_enc") or ""),
    )


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
    provider_errors: list[str] = []
    mailings_with_id = [a for a in (asns.data or []) if a.get("vendeai_mailing_id")]
    for asn in mailings_with_id:
        try:
            await vendeai.pause(asn["vendeai_mailing_id"])
        except Exception as e:
            provider_errors.append(f"mailing {asn['vendeai_mailing_id']}: {e}")
    if provider_errors and len(provider_errors) == len(mailings_with_id):
        raise HTTPException(502, f"Pause falhou em todos os mailings: {'; '.join(provider_errors[:3])}")
    db.table("broadcast_dispatch_assignments").update({"status": "paused"}) \
        .eq("dispatch_id", dispatch_id).eq("owner_id", user_id).execute()
    db.table("broadcast_dispatches").update({"status": "paused"}) \
        .eq("id", dispatch_id).eq("owner_id", user_id).execute()
    result: dict = {"ok": True}
    if provider_errors:
        result["provider_warnings"] = provider_errors
    return result


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
    provider_errors: list[str] = []
    mailings_with_id = [a for a in (asns.data or []) if a.get("vendeai_mailing_id")]
    for asn in mailings_with_id:
        try:
            await vendeai.resume(asn["vendeai_mailing_id"])
        except Exception as e:
            provider_errors.append(f"mailing {asn['vendeai_mailing_id']}: {e}")
    if provider_errors and len(provider_errors) == len(mailings_with_id):
        raise HTTPException(502, f"Resume falhou em todos os mailings: {'; '.join(provider_errors[:3])}")
    db.table("broadcast_dispatch_assignments").update({"status": "running"}) \
        .eq("dispatch_id", dispatch_id).eq("owner_id", user_id).execute()
    db.table("broadcast_dispatches").update({"status": "running"}) \
        .eq("id", dispatch_id).eq("owner_id", user_id).execute()
    result: dict = {"ok": True}
    if provider_errors:
        result["provider_warnings"] = provider_errors
    return result


@router.post("/dispatches/{dispatch_id}/revoke")
async def revoke_dispatch(dispatch_id: str, user_id: str = Depends(_get_user_id)):
    db = get_db()
    vendeai = await _get_vendeai_for_user(user_id)
    asns = db.table("broadcast_dispatch_assignments") \
        .select("vendeai_mailing_id") \
        .eq("dispatch_id", dispatch_id) \
        .eq("owner_id", user_id) \
        .execute()
    provider_errors: list[str] = []
    mailings_with_id = [a for a in (asns.data or []) if a.get("vendeai_mailing_id")]
    for asn in mailings_with_id:
        try:
            await vendeai.cancel(asn["vendeai_mailing_id"])
        except Exception as e:
            provider_errors.append(f"mailing {asn['vendeai_mailing_id']}: {e}")
    if provider_errors and len(provider_errors) == len(mailings_with_id):
        raise HTTPException(502, f"Revoke falhou em todos os mailings: {'; '.join(provider_errors[:3])}")
    db.table("broadcast_dispatch_assignments").update({"status": "failed"}) \
        .eq("dispatch_id", dispatch_id).eq("owner_id", user_id).execute()
    db.table("broadcast_dispatches").update({
        "status": "revoked",
        "finished_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", dispatch_id).eq("owner_id", user_id).execute()
    result: dict = {"ok": True}
    if provider_errors:
        result["provider_warnings"] = provider_errors
    return result


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

    async def _fetch_waba(wid: str) -> tuple[str, list]:
        try:
            tpls = await meta.get_templates(wid)
            return wid, sorted([
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
            return wid, []

    pairs = await asyncio.gather(*[_fetch_waba(wid) for wid in waba_ids])
    return dict(pairs)


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
