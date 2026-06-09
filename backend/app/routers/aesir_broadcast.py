import asyncio
import csv
import io
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

import redis.asyncio as aioredis

log = logging.getLogger(__name__)
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from app.config import settings
from app.credentials.crypto import encrypt, safe_decrypt
from app.database import get_db
from app.services.broadcast.aesir_client import AesirClient
from app.services.broadcast.meta_client import MetaClient

router = APIRouter(prefix="/api/aesir-broadcast", tags=["aesir-broadcast"])
security = HTTPBearer()

# stop events and strong task refs keyed by dispatch_id
_stop_events: dict[str, asyncio.Event] = {}
_bg_tasks: set[asyncio.Task] = set()


# ── Auth helpers ───────────────────────────────────────────────────────────────

def _get_user_id(credentials: HTTPAuthorizationCredentials = Depends(security)) -> str:
    db = get_db()
    try:
        resp = db.auth.get_user(credentials.credentials)
        return resp.user.id
    except HTTPException:
        raise
    except Exception as exc:
        msg = str(exc).lower()
        if any(k in msg for k in ("invalid", "expired", "unauthorized", "jwt", "token")):
            raise HTTPException(status_code=401, detail="Invalid token")
        log.exception("_get_user_id unexpected error")
        raise HTTPException(status_code=503, detail="Auth service unavailable")


def _get_client(user_id: str) -> AesirClient:
    db = get_db()
    resp = db.table("aesir_settings").select("*").eq("owner_id", user_id).execute()
    if not resp.data:
        raise HTTPException(400, "Credenciais Aesir não configuradas")
    row = resp.data[0]
    token = safe_decrypt(row["api_token_enc"])
    if not token:
        raise HTTPException(400, "Token Aesir inválido — reconfigure")
    return AesirClient(api_token=token, account_id=row["account_id"])


def _advise_split(instances: list[dict], total_leads: int) -> dict[str, Any]:
    """Distribute leads proportionally across eligible Aesir instances."""
    def is_eligible(inst: dict) -> bool:
        if inst.get("is_paused"):
            return False
        can_send = inst.get("can_send", "UNKNOWN")
        if can_send in ("DISABLED", "BLOCKED"):
            return False
        if inst.get("quality_rating") == "RED":
            return False
        if (inst.get("daily_limit") or 500) <= 0:
            return False
        return True

    active = [i for i in instances if is_eligible(i)]
    excluded = [i for i in instances if not is_eligible(i)]

    if not active:
        return {
            "assignments": [],
            "justification": "Nenhuma instância elegível para disparo.",
            "risks": "Verifique se há instâncias ativas com qualidade OK.",
        }

    total_capacity = sum(i.get("daily_limit") or 500 for i in active)
    remaining = total_leads
    assignments = []

    for idx, inst in enumerate(active):
        limit = inst.get("daily_limit") or 500
        if idx == len(active) - 1:
            planned = min(remaining, limit)
        else:
            planned = min(round(total_leads * limit / total_capacity), remaining, limit)
        remaining -= planned
        assignments.append({
            "instance_id": inst["instance_id"],
            "name": inst.get("name") or inst["instance_id"],
            "display_phone": inst.get("display_phone") or inst.get("phone") or "",
            "quality_rating": inst.get("quality_rating", "UNKNOWN"),
            "can_send": inst.get("can_send", "UNKNOWN"),
            "daily_limit": limit,
            "planned_count": planned,
        })

    risks = []
    paused = [i for i in excluded if i.get("is_paused")]
    blocked = [i for i in excluded if i.get("can_send") in ("DISABLED", "BLOCKED")]
    red = [i for i in excluded if i.get("quality_rating") == "RED"]
    if paused:
        risks.append(f"{len(paused)} instância(s) pausada(s) excluída(s)")
    if blocked:
        risks.append(f"{len(blocked)} instância(s) bloqueada(s) excluída(s)")
    if red:
        risks.append(f"{len(red)} instância(s) com qualidade RED excluída(s)")
    if total_leads > total_capacity:
        risks.append(f"Total de leads ({total_leads}) excede capacidade diária ({total_capacity})")

    return {
        "assignments": assignments,
        "justification": f"Distribuição proporcional entre {len(active)} instância(s) ativa(s).",
        "risks": "; ".join(risks) if risks else "Nenhum risco identificado.",
    }


# ── Credentials ───────────────────────────────────────────────────────────────

class AesirCredsIn(BaseModel):
    api_token: str
    account_id: str


class AesirMetaCredsIn(BaseModel):
    meta_token: str
    waba_ids: list[str]


@router.post("/credentials")
async def save_credentials(body: AesirCredsIn, user_id: str = Depends(_get_user_id)):
    db = get_db()
    payload = {
        "owner_id": user_id,
        "api_token_enc": encrypt(body.api_token.strip()),
        "account_id": body.account_id.strip(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    db.table("aesir_settings").upsert(payload, on_conflict="owner_id").execute()
    return {"ok": True}


@router.post("/meta-credentials")
async def save_meta_credentials(body: AesirMetaCredsIn, user_id: str = Depends(_get_user_id)):
    db = get_db()
    existing = db.table("aesir_settings").select("owner_id").eq("owner_id", user_id).execute()
    if not existing.data:
        raise HTTPException(400, "Configure as credenciais Aesir primeiro")
    payload = {
        "owner_id": user_id,
        "meta_token_enc": encrypt(body.meta_token.strip()),
        "waba_ids": [w.strip() for w in body.waba_ids if w.strip()],
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    db.table("aesir_settings").update(payload).eq("owner_id", user_id).execute()
    return {"ok": True}


@router.get("/credentials")
async def get_credentials(user_id: str = Depends(_get_user_id)):
    db = get_db()
    resp = db.table("aesir_settings").select("owner_id, account_id, meta_token_enc, waba_ids, updated_at").eq("owner_id", user_id).execute()
    if not resp.data:
        return {"configured": False}
    row = resp.data[0]
    return {
        "configured": True,
        "account_id": row["account_id"],
        "meta_configured": bool(row.get("meta_token_enc")),
        "waba_ids": row.get("waba_ids") or [],
        "updated_at": row["updated_at"],
    }


# ── Instances ─────────────────────────────────────────────────────────────────

@router.get("/instances")
async def list_instances(user_id: str = Depends(_get_user_id)):
    db = get_db()
    stored = db.table("aesir_instances").select("*").eq("owner_id", user_id).execute()
    return stored.data or []


@router.post("/instances/{instance_id}/pause")
async def pause_instance(instance_id: str, user_id: str = Depends(_get_user_id)):
    db = get_db()
    db.table("aesir_instances").update({"is_paused": True}).eq("owner_id", user_id).eq("instance_id", instance_id).execute()
    return {"ok": True}


@router.post("/instances/{instance_id}/resume")
async def resume_instance(instance_id: str, user_id: str = Depends(_get_user_id)):
    db = get_db()
    db.table("aesir_instances").update({"is_paused": False}).eq("owner_id", user_id).eq("instance_id", instance_id).execute()
    return {"ok": True}


@router.post("/refresh-numbers")
async def refresh_numbers(user_id: str = Depends(_get_user_id)):
    """Pull Aesir instances + Meta phones → cross-reference → upsert.

    Resilience rules:
    - Aesir error is non-fatal (returns 200 with `aesir_error` set + Meta-only numbers).
    - Meta error is non-fatal (returns 200 with `meta_error` set + Aesir-only numbers).
    - Meta phones with no matching Aesir instance are upserted as `meta-only` rows so user can see all BM numbers.
    """
    db = get_db()
    settings_row = db.table("aesir_settings").select("*").eq("owner_id", user_id).execute()
    if not settings_row.data:
        raise HTTPException(400, "Credenciais não configuradas")
    row = settings_row.data[0]

    aesir_token = safe_decrypt(row.get("api_token_enc") or "")
    meta_token = safe_decrypt(row.get("meta_token_enc") or "")

    if not aesir_token and not meta_token:
        raise HTTPException(400, "Configure ao menos um token (Aesir ou Meta) antes de sincronizar.")

    # ── Step 1: Meta discovery (independent of Aesir) ────────────────────────
    waba_ids: list[str] = row.get("waba_ids") or []
    meta_phones: dict[str, dict] = {}
    meta_phones_list: list[dict] = []
    meta_error: str | None = None
    if meta_token:
        meta_client = MetaClient(access_token=meta_token)
        try:
            if waba_ids:
                # Manual WABA IDs provided — use them
                for wid in waba_ids:
                    try:
                        meta_phones_list.extend(await meta_client.get_all_phones(wid))
                    except Exception:
                        pass
            else:
                # Auto-discover WABAs from token
                meta_phones_list = await meta_client.get_all_phones_auto()

            for p in meta_phones_list:
                raw = "".join(c for c in (p.get("display_phone") or "") if c.isdigit())
                key = raw[-10:] if len(raw) >= 10 else raw
                if key:
                    meta_phones[key] = p
        except Exception as e:
            meta_error = str(e)

    # ── Step 2: Aesir instances (non-fatal) ──────────────────────────────────
    aesir_instances: list[dict] = []
    aesir_error: str | None = None
    if aesir_token:
        try:
            client = AesirClient(api_token=aesir_token, account_id=row["account_id"])
            aesir_instances = await client.list_instances()
        except Exception as e:
            aesir_error = str(e)

    now = datetime.now(timezone.utc).isoformat()

    # ── Step 3: Upsert Aesir instances (cross-referenced with Meta) ─────────
    matched_keys: set[str] = set()
    for inst in aesir_instances:
        iid = str(inst.get("id") or inst.get("instance_id") or "")
        if not iid:
            continue
        phone_raw = inst.get("phone") or inst.get("phone_number") or ""
        digits = "".join(c for c in phone_raw if c.isdigit())
        key = digits[-10:] if len(digits) >= 10 else digits
        quality = meta_phones.get(key, {})
        if key and quality:
            matched_keys.add(key)
        upsert_payload: dict = {
            "owner_id": user_id,
            "instance_id": iid,
            "name": inst.get("name") or inst.get("instance_name") or iid,
            "phone": phone_raw,
            "status": inst.get("status") or inst.get("connection_status") or "unknown",
            "updated_at": now,
        }
        if quality:
            upsert_payload.update({
                "display_phone": quality.get("display_phone"),
                "quality_rating": quality.get("quality_rating", "UNKNOWN"),
                "messaging_tier": quality.get("messaging_tier"),
                "can_send": quality.get("can_send", "UNKNOWN"),
                "daily_limit": quality.get("daily_limit") or 500,
                "waba_id": quality.get("waba_id"),
                "phone_id": quality.get("phone_id"),
                "verified_name": quality.get("verified_name"),
                "name_status": quality.get("name_status"),
                "account_mode": quality.get("account_mode"),
                "restrictions": quality.get("restrictions") or [],
                "additional_info": quality.get("additional_info") or [],
                "has_payment_issue": quality.get("has_payment_issue", False),
                "display_name_pending": quality.get("display_name_pending", False),
                "waba_name": quality.get("waba_name"),
                "account_review_status": quality.get("account_review_status"),
                "business_verification_status": quality.get("business_verification_status"),
                "waba_currency": quality.get("waba_currency"),
                "waba_country": quality.get("waba_country"),
                "quality_updated_at": now,
            })
        db.table("aesir_instances").upsert(upsert_payload, on_conflict="owner_id,instance_id").execute()

    # ── Step 4: Upsert Meta-only phones (no matching Aesir instance) ────────
    # Allows user to see every WABA number even when Aesir is down/misconfigured.
    for p in meta_phones_list:
        raw = "".join(c for c in (p.get("display_phone") or "") if c.isdigit())
        key = raw[-10:] if len(raw) >= 10 else raw
        if not key or key in matched_keys:
            continue
        phone_id = p.get("phone_id") or p.get("id") or key
        meta_iid = f"meta:{phone_id}"
        db.table("aesir_instances").upsert({
            "owner_id": user_id,
            "instance_id": meta_iid,
            "name": p.get("verified_name") or p.get("display_phone") or meta_iid,
            "phone": p.get("display_phone") or "",
            "status": "meta-only",
            "display_phone": p.get("display_phone"),
            "quality_rating": p.get("quality_rating", "UNKNOWN"),
            "messaging_tier": p.get("messaging_tier"),
            "can_send": p.get("can_send", "UNKNOWN"),
            "daily_limit": p.get("daily_limit") or 500,
            "waba_id": p.get("waba_id"),
            "phone_id": p.get("phone_id"),
            "verified_name": p.get("verified_name"),
            "name_status": p.get("name_status"),
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
            "quality_updated_at": now,
            "updated_at": now,
        }, on_conflict="owner_id,instance_id").execute()

    stored = db.table("aesir_instances").select("*").eq("owner_id", user_id).execute()
    return {
        "ok": True,
        "instances": stored.data or [],
        "meta_matched": len(meta_phones),
        "meta_total": len(meta_phones_list),
        "aesir_error": aesir_error,
        "meta_error": meta_error,
    }


# ── Analyze CSV ───────────────────────────────────────────────────────────────

@router.post("/analyze")
async def analyze_csv(file: UploadFile = File(...), user_id: str = Depends(_get_user_id)):
    db = get_db()
    csv_bytes = await file.read()
    if csv_bytes.startswith(b"\xef\xbb\xbf"):
        csv_bytes = csv_bytes[3:]

    csv_text_tmp = csv_bytes.decode("utf-8", errors="replace")
    total_leads = max(0, len([l for l in csv_text_tmp.splitlines() if l.strip()]) - 1)

    csv_columns: list[str] = []
    try:
        first_line = csv_bytes.decode("utf-8", errors="replace").splitlines()[0]
        for delim in [",", ";", "\t", "|"]:
            if delim in first_line:
                csv_columns = [c.strip().strip('"').lstrip("﻿") for c in first_line.split(delim)]
                break
        if not csv_columns:
            csv_columns = [first_line.strip()]
    except Exception:
        csv_columns = []

    instances_resp = db.table("aesir_instances").select("*").eq("owner_id", user_id).execute()
    instances = instances_resp.data or []
    if not instances:
        raise HTTPException(400, "Nenhuma instância cadastrada. Faça Refresh Números primeiro.")

    split = _advise_split(instances, total_leads)

    dispatch_id = str(uuid.uuid4())
    db.table("aesir_dispatches").insert({
        "id": dispatch_id,
        "owner_id": user_id,
        "csv_filename": file.filename,
        "total_leads": total_leads,
        "status": "pending_confirm",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).execute()

    try:
        async with aioredis.from_url(settings.redis_url, socket_connect_timeout=5) as r:
            await r.setex(f"aesir:csv:{user_id}:{dispatch_id}", 3600, csv_bytes)
    except Exception as redis_err:
        db.table("aesir_dispatches").delete().eq("id", dispatch_id).eq("owner_id", user_id).execute()
        raise HTTPException(503, f"Serviço de cache indisponível. Tente novamente em instantes. ({type(redis_err).__name__})")

    return {
        "dispatch_id": dispatch_id,
        "total_leads": total_leads,
        "split": split,
        "csv_columns": csv_columns,
    }


# ── Dispatch (confirm) ────────────────────────────────────────────────────────

class AssignmentIn(BaseModel):
    instance_id: str
    planned_count: int


class DispatchIn(BaseModel):
    dispatch_id: str
    assignments: list[AssignmentIn]
    message_tpl: str
    phone_column: str = "telefone"
    campaign_name: str = ""
    cooldown_seconds: int = 5


@router.post("/dispatch")
async def confirm_dispatch(body: DispatchIn, user_id: str = Depends(_get_user_id)):
    db = get_db()

    dispatch = db.table("aesir_dispatches").select("*").eq("id", body.dispatch_id).eq("owner_id", user_id).execute()
    if not dispatch.data:
        raise HTTPException(404, "Dispatch não encontrado")
    if dispatch.data[0]["status"] != "pending_confirm":
        raise HTTPException(400, f"Dispatch já em status {dispatch.data[0]['status']}")

    async with aioredis.from_url(settings.redis_url) as r:
        csv_bytes = await r.get(f"aesir:csv:{user_id}:{body.dispatch_id}")
    if not csv_bytes:
        raise HTTPException(400, "CSV expirou (1h). Faça upload novamente.")
    if csv_bytes.startswith(b"\xef\xbb\xbf"):
        csv_bytes = csv_bytes[3:]

    csv_text = csv_bytes.decode("utf-8", errors="replace")
    csv_lines = csv_text.splitlines()
    header = csv_lines[0] if csv_lines else ""
    data_rows = csv_lines[1:] if len(csv_lines) > 1 else []

    def _slice_csv(rows: list[str], start: int, count: int) -> bytes:
        actual = rows[start: start + count]
        if len(actual) < count:
            log.warning("aesir _slice_csv: requested %d rows from offset %d but only %d available", count, start, len(actual))
        chunk = [header] + actual
        return "\n".join(chunk).encode("utf-8")

    # Build assignments_json with initial state
    assignments_json = [
        {"instance_id": a.instance_id, "planned": a.planned_count, "sent": 0, "errors": 0, "status": "queued"}
        for a in body.assignments
    ]

    now = datetime.now(timezone.utc).isoformat()
    db.table("aesir_dispatches").update({
        "status": "running",
        "campaign_name": body.campaign_name or body.dispatch_id[:8],
        "phone_column": body.phone_column,
        "message_tpl": body.message_tpl,
        "cooldown_seconds": body.cooldown_seconds,
        "assignments_json": assignments_json,
        "updated_at": now,
    }).eq("id", body.dispatch_id).execute()

    stop_event = asyncio.Event()
    _stop_events[body.dispatch_id] = stop_event

    client = _get_client(user_id)

    async def _run():
        row_offset = 0
        _success_count = 0
        _error_count = 0
        try:
            for asn_model in body.assignments:
                if stop_event.is_set():
                    break
                iid = asn_model.instance_id
                planned = asn_model.planned_count
                slice_bytes = _slice_csv(data_rows, row_offset, planned)
                row_offset += planned

                _update_assignment(body.dispatch_id, iid, {"status": "running"}, db)

                try:
                    result = await client.dispatch_csv(
                        csv_bytes=slice_bytes,
                        instance_id=iid,
                        message_tpl=body.message_tpl,
                        phone_column=body.phone_column,
                        cooldown_seconds=body.cooldown_seconds,
                        stop_event=stop_event,
                    )
                    _update_assignment(body.dispatch_id, iid, {
                        "sent": result["sent"],
                        "errors": result["errors"],
                        "status": "done" if not stop_event.is_set() else "paused",
                    }, db)
                    _success_count += 1
                except asyncio.CancelledError:
                    _update_assignment(body.dispatch_id, iid, {"status": "paused"}, db)
                    raise
                except Exception as exc:
                    log.exception("aesir dispatch error instance=%s dispatch=%s", iid, body.dispatch_id)
                    _update_assignment(body.dispatch_id, iid, {"status": "error"}, db)
                    _error_count += 1

            if stop_event.is_set():
                final = "paused"
            elif _error_count == 0:
                final = "done"
            elif _success_count == 0:
                final = "error"
            else:
                final = "partial_error"
        except asyncio.CancelledError:
            final = "paused"
        except Exception:
            log.exception("aesir _run unhandled error dispatch=%s", body.dispatch_id)
            final = "error"
        finally:
            # Don't overwrite terminal state set by cancel endpoint
            current = db.table("aesir_dispatches").select("status").eq("id", body.dispatch_id).execute()
            current_status = (current.data[0].get("status") if current.data else None)
            if current_status not in ("cancelled",):
                db.table("aesir_dispatches").update({
                    "status": final,
                    "finished_at": datetime.now(timezone.utc).isoformat(),
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }).eq("id", body.dispatch_id).execute()
            _stop_events.pop(body.dispatch_id, None)
            _bg_tasks.discard(task)

    task = asyncio.create_task(_run())
    _bg_tasks.add(task)
    task.add_done_callback(_bg_tasks.discard)
    return {"dispatch_id": body.dispatch_id, "status": "running"}


def _update_assignment(dispatch_id: str, instance_id: str, patch: dict, db) -> None:
    """Update a single assignment's fields inside assignments_json."""
    resp = db.table("aesir_dispatches").select("assignments_json").eq("id", dispatch_id).execute()
    if not resp.data:
        return
    assignments = resp.data[0].get("assignments_json") or []
    merged = [
        {**asn, **patch} if asn.get("instance_id") == instance_id else asn
        for asn in assignments
    ]
    db.table("aesir_dispatches").update({
        "assignments_json": merged,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", dispatch_id).execute()


# ── Dispatch control ──────────────────────────────────────────────────────────

@router.post("/dispatches/{dispatch_id}/pause")
async def pause_dispatch(dispatch_id: str, user_id: str = Depends(_get_user_id)):
    ev = _stop_events.get(dispatch_id)
    if ev:
        ev.set()
    db = get_db()
    existing = db.table("aesir_dispatches").select("id").eq("id", dispatch_id).eq("owner_id", user_id).execute()
    if not existing.data:
        raise HTTPException(404, "Dispatch não encontrado")
    db.table("aesir_dispatches").update({
        "status": "paused",
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", dispatch_id).eq("owner_id", user_id).execute()
    return {"ok": True}


@router.post("/dispatches/{dispatch_id}/cancel")
async def cancel_dispatch(dispatch_id: str, user_id: str = Depends(_get_user_id)):
    ev = _stop_events.get(dispatch_id)
    if ev:
        ev.set()
    db = get_db()
    existing = db.table("aesir_dispatches").select("id").eq("id", dispatch_id).eq("owner_id", user_id).execute()
    if not existing.data:
        raise HTTPException(404, "Dispatch não encontrado")
    db.table("aesir_dispatches").update({
        "status": "cancelled",
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", dispatch_id).eq("owner_id", user_id).execute()
    return {"ok": True}


# ── Read endpoints ────────────────────────────────────────────────────────────

@router.get("/snapshot")
async def get_snapshot(user_id: str = Depends(_get_user_id)):
    db = get_db()
    instances = db.table("aesir_instances").select("*").eq("owner_id", user_id).execute()
    active = db.table("aesir_dispatches").select("*").eq("owner_id", user_id).in_("status", ["running", "paused"]).order("created_at", desc=True).limit(10).execute()
    return {
        "instances": instances.data or [],
        "active_dispatches": active.data or [],
    }


@router.get("/dispatches")
async def list_dispatches(user_id: str = Depends(_get_user_id)):
    db = get_db()
    resp = db.table("aesir_dispatches").select("*").eq("owner_id", user_id).not_.eq("status", "pending_confirm").order("created_at", desc=True).limit(50).execute()
    return resp.data or []


@router.get("/analytics")
async def get_analytics(user_id: str = Depends(_get_user_id)):
    db = get_db()
    resp = db.table("aesir_dispatches").select("id, campaign_name, total_leads, assignments_json, status, created_at, finished_at").eq("owner_id", user_id).not_.eq("status", "pending_confirm").order("created_at", desc=True).limit(20).execute()
    rows = resp.data or []
    total_sent = 0
    total_errors = 0
    for r in rows:
        asns = r.get("assignments_json") or []
        r["sent"] = sum(a.get("sent", 0) for a in asns)
        r["errors"] = sum(a.get("errors", 0) for a in asns)
        total_sent += r["sent"]
        total_errors += r["errors"]
    return {
        "campaigns": rows,
        "total_sent": total_sent,
        "total_errors": total_errors,
        "total_campaigns": len(rows),
    }
