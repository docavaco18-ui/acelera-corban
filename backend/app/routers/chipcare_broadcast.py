"""
Chipcare Broadcast router — /api/chipcare-broadcast/*

Fluxo:
1. POST /credentials — salva email/senha/tenant_id Chipcare
2. POST /refresh-channels — login + pull canais oficiais → DB
3. GET /channels — lista canais do DB
4. GET /templates — lista templates HSM via SA
5. POST /analyze — upload CSV → Redis (1h TTL) + split proporcional por daily_limit
6. POST /dispatch — cria campanha no Chipcare (dry_run=false) + ativa
7. GET /dispatches — histórico
8. GET /snapshot — campanhas ativas (poll 15s)
9. GET /analytics — stats

Dry-run obrigatório antes de ativar campanha real:
  body.dry_run=true → valida parâmetros sem criar nada no Chipcare.
  body.dry_run=false (default false) → cria + ativa.
"""

import asyncio
import csv
import io
import logging
import uuid
from datetime import datetime, timezone

import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from app.config import settings
from app.credentials.crypto import encrypt, safe_decrypt
from app.database import get_db
from app.services.broadcast.chipcare_client import (
    ChipcareClient,
    ChipcareHashes,
    build_template_payload,
    csv_to_xlsx_bytes,
)

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/chipcare-broadcast", tags=["chipcare-broadcast"])
security = HTTPBearer()


# ── Auth helpers ──────────────────────────────────────────────────────────────

def _get_user_id(credentials: HTTPAuthorizationCredentials = Depends(security)) -> str:
    db = get_db()
    try:
        resp = db.auth.get_user(credentials.credentials)
        return resp.user.id
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")


def _get_client_and_settings(user_id: str) -> tuple[ChipcareClient, dict]:
    db = get_db()
    resp = db.table("chipcare_settings").select("*").eq("owner_id", user_id).execute()
    if not resp.data:
        raise HTTPException(400, "Credenciais Chipcare não configuradas")
    row = resp.data[0]
    email = safe_decrypt(row["email_enc"])
    password = safe_decrypt(row["password_enc"])
    if not email or not password:
        raise HTTPException(400, "Credenciais Chipcare inválidas — reconfigure")
    hashes = ChipcareHashes(
        sa_create=row.get("sa_create") or ChipcareHashes.sa_create,
        sa_activate=row.get("sa_activate") or ChipcareHashes.sa_activate,
        sa_list_tpl=row.get("sa_list_tpl") or ChipcareHashes.sa_list_tpl,
        sa_list_camps=row.get("sa_list_camps") or ChipcareHashes.sa_list_camps,
    )
    client = ChipcareClient(email=email, password=password, hashes=hashes)
    return client, row


def _advise_split(channels: list[dict], total_leads: int) -> dict:
    """Distribute leads proportionally across eligible official channels."""
    def is_eligible(ch: dict) -> bool:
        if ch.get("is_paused"):
            return False
        if ch.get("status") not in ("CONNECTED", "Online", "ONLINE", "online"):
            return False
        if (ch.get("daily_limit") or 500) <= 0:
            return False
        return True

    active = [c for c in channels if is_eligible(c)]
    excluded = [c for c in channels if not is_eligible(c)]

    if not active:
        return {
            "assignments": [],
            "justification": "Nenhum canal Chipcare elegível.",
            "risks": "Verifique se há canais Oficial conectados.",
        }

    total_capacity = sum(c.get("daily_limit") or 500 for c in active)
    remaining = total_leads
    assignments = []

    for idx, ch in enumerate(active):
        limit = ch.get("daily_limit") or 500
        if idx == len(active) - 1:
            planned = remaining
        else:
            planned = min(round(total_leads * limit / total_capacity), remaining, limit)
        remaining -= planned
        assignments.append({
            "channel_id": ch["channel_id"],
            "title": ch.get("title") or str(ch["channel_id"]),
            "status": ch.get("status", "UNKNOWN"),
            "daily_limit": limit,
            "planned_count": planned,
        })

    risks = []
    offline = [c for c in excluded if not c.get("is_paused")]
    paused = [c for c in excluded if c.get("is_paused")]
    if offline:
        risks.append(f"{len(offline)} canal(is) offline excluído(s)")
    if paused:
        risks.append(f"{len(paused)} canal(is) pausado(s) excluído(s)")
    if total_leads > total_capacity:
        risks.append(f"Total leads ({total_leads}) > capacidade diária ({total_capacity})")

    return {
        "assignments": assignments,
        "justification": f"Distribuição proporcional entre {len(active)} canal(is) ativo(s).",
        "risks": "; ".join(risks) if risks else "Nenhum risco identificado.",
    }


# ── Credentials ───────────────────────────────────────────────────────────────

class ChipcareCredsIn(BaseModel):
    email: str
    password: str
    tenant_id: str = ""


@router.post("/credentials")
async def save_credentials(body: ChipcareCredsIn, user_id: str = Depends(_get_user_id)):
    db = get_db()
    payload = {
        "owner_id": user_id,
        "email_enc": encrypt(body.email.strip()),
        "password_enc": encrypt(body.password.strip()),
        "tenant_id": body.tenant_id.strip() or None,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    db.table("chipcare_settings").upsert(payload, on_conflict="owner_id").execute()
    return {"ok": True}


class SaHashesIn(BaseModel):
    sa_create: str | None = None
    sa_activate: str | None = None
    sa_list_tpl: str | None = None
    sa_list_camps: str | None = None


@router.post("/sa-hashes")
async def update_sa_hashes(body: SaHashesIn, user_id: str = Depends(_get_user_id)):
    """Atualizar hashes SA quando Chipcare fizer deploy e os hashes mudarem."""
    db = get_db()
    patch = {k: v for k, v in body.dict().items() if v}
    patch["updated_at"] = datetime.now(timezone.utc).isoformat()
    db.table("chipcare_settings").update(patch).eq("owner_id", user_id).execute()
    return {"ok": True, "updated": list(patch.keys())}


@router.get("/credentials")
async def get_credentials(user_id: str = Depends(_get_user_id)):
    db = get_db()
    resp = db.table("chipcare_settings").select(
        "owner_id, tenant_id, sa_create, sa_activate, updated_at"
    ).eq("owner_id", user_id).execute()
    if not resp.data:
        return {"configured": False}
    row = resp.data[0]
    return {
        "configured": True,
        "tenant_id": row.get("tenant_id"),
        "sa_create": (row.get("sa_create") or "")[:8] + "...",
        "sa_activate": (row.get("sa_activate") or "")[:8] + "...",
        "updated_at": row["updated_at"],
    }


# ── Channels ──────────────────────────────────────────────────────────────────

@router.post("/refresh-channels")
async def refresh_channels(user_id: str = Depends(_get_user_id)):
    """Login no Chipcare + pull canais WA Oficial → salvar no DB."""
    client, row = _get_client_and_settings(user_id)
    try:
        jwt = await client.login(tenant_id=row.get("tenant_id"))
    except Exception as e:
        raise HTTPException(502, f"Login Chipcare falhou: {e}")

    # Save user_id for createCampaign _1_createdBy
    if client._user_id:
        db = get_db()
        db.table("chipcare_settings").update(
            {"chipcare_user_id": client._user_id}
        ).eq("owner_id", user_id).execute()

    try:
        channels = await client.list_channels(jwt)
    except Exception as e:
        raise HTTPException(502, f"Chipcare list_channels falhou: {e}")

    db = get_db()
    now = datetime.now(timezone.utc).isoformat()
    for ch in channels:
        cid = ch.get("id")
        if not cid:
            continue
        db.table("chipcare_channels").upsert({
            "owner_id": user_id,
            "channel_id": int(cid),
            "title": ch.get("title") or str(cid),
            "status": ch.get("status") or "CLOSED",
            "channel_type": ch.get("channelType") or "WHATSAPP_OFFICIAL",
            "description": ch.get("description") or "",
            "updated_at": now,
        }, on_conflict="owner_id,channel_id").execute()

    stored = db.table("chipcare_channels").select("*").eq("owner_id", user_id).execute()
    return {"ok": True, "channels": stored.data or [], "count": len(channels)}


@router.get("/channels")
async def list_channels(user_id: str = Depends(_get_user_id)):
    db = get_db()
    resp = db.table("chipcare_channels").select("*").eq("owner_id", user_id).execute()
    return resp.data or []


@router.post("/channels/{channel_id}/pause")
async def pause_channel(channel_id: int, user_id: str = Depends(_get_user_id)):
    db = get_db()
    db.table("chipcare_channels").update({"is_paused": True}).eq("owner_id", user_id).eq("channel_id", channel_id).execute()
    return {"ok": True}


@router.post("/channels/{channel_id}/resume")
async def resume_channel(channel_id: int, user_id: str = Depends(_get_user_id)):
    db = get_db()
    db.table("chipcare_channels").update({"is_paused": False}).eq("owner_id", user_id).eq("channel_id", channel_id).execute()
    return {"ok": True}


# ── Templates ─────────────────────────────────────────────────────────────────

@router.get("/templates")
async def list_templates(user_id: str = Depends(_get_user_id)):
    """Login no Chipcare + SA getCommonChannelTemplates → retorna templates HSM."""
    db = get_db()
    client, row = _get_client_and_settings(user_id)
    # Get stored channel IDs (non-paused WHATSAPP_OFFICIAL)
    ch_resp = db.table("chipcare_channels").select("channel_id").eq("owner_id", user_id).eq("is_paused", False).execute()
    channel_ids = [r["channel_id"] for r in (ch_resp.data or [])]
    try:
        jwt = await client.login(tenant_id=row.get("tenant_id"))
        templates = await client.list_templates(jwt, channel_ids=channel_ids or None)
    except Exception as e:
        raise HTTPException(502, f"Chipcare list_templates falhou: {e}")
    return {"templates": templates}


# ── Analyze CSV ───────────────────────────────────────────────────────────────

@router.post("/analyze")
async def analyze_csv(file: UploadFile = File(...), user_id: str = Depends(_get_user_id)):
    """Upload CSV → Redis (1h TTL) + split proporcional por canal."""
    db = get_db()
    csv_bytes = await file.read()
    if csv_bytes.startswith(b"\xef\xbb\xbf"):
        csv_bytes = csv_bytes[3:]

    csv_text = csv_bytes.decode("utf-8", errors="replace")
    total_leads = max(0, len([l for l in csv_text.splitlines() if l.strip()]) - 1)

    csv_columns: list[str] = []
    try:
        first_line = csv_text.splitlines()[0]
        for delim in [",", ";", "\t", "|"]:
            if delim in first_line:
                csv_columns = [c.strip().strip('"').lstrip("﻿") for c in first_line.split(delim)]
                break
        if not csv_columns:
            csv_columns = [first_line.strip()]
    except Exception:
        csv_columns = []

    channels_resp = db.table("chipcare_channels").select("*").eq("owner_id", user_id).execute()
    channels = channels_resp.data or []
    if not channels:
        raise HTTPException(400, "Nenhum canal cadastrado. Faça Refresh Canais primeiro.")

    split = _advise_split(channels, total_leads)

    dispatch_id = str(uuid.uuid4())
    db.table("chipcare_dispatches").insert({
        "id": dispatch_id,
        "owner_id": user_id,
        "csv_filename": file.filename,
        "total_leads": total_leads,
        "status": "pending_confirm",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).execute()

    r = aioredis.from_url(settings.redis_url)
    try:
        await r.setex(f"chipcare:csv:{dispatch_id}", 3600, csv_bytes)
    finally:
        await r.aclose()

    return {
        "dispatch_id": dispatch_id,
        "total_leads": total_leads,
        "split": split,
        "csv_columns": csv_columns,
    }


# ── Dispatch ──────────────────────────────────────────────────────────────────

class AssignmentIn(BaseModel):
    channel_id: int
    planned_count: int


class TemplateIn(BaseModel):
    template_name: str
    template_id: str
    language_code: str = "pt_BR"
    components: list[dict] = []


class ChipcareDispatchIn(BaseModel):
    dispatch_id: str
    assignments: list[AssignmentIn]
    template: TemplateIn
    campaign_name: str = ""
    aggression_level: str = "MEDIUM"
    min_interval_ms: int = 3000
    max_interval_ms: int = 8000
    chat_status: str = "ALL"
    channel_mode: str = "ANY_CHANNEL"
    source_type: str = "XLSX_FILE"
    activate_immediately: bool = False
    dry_run: bool = False  # OBRIGATÓRIO false para disparo real


@router.post("/dispatch")
async def confirm_dispatch(body: ChipcareDispatchIn, user_id: str = Depends(_get_user_id)):
    """Cria campanha no Chipcare. dry_run=true para validar sem criar."""
    db = get_db()

    dispatch = db.table("chipcare_dispatches").select("*").eq("id", body.dispatch_id).eq("owner_id", user_id).execute()
    if not dispatch.data:
        raise HTTPException(404, "Dispatch não encontrado")
    if dispatch.data[0]["status"] != "pending_confirm":
        raise HTTPException(400, f"Dispatch já em status {dispatch.data[0]['status']}")

    r = aioredis.from_url(settings.redis_url)
    csv_bytes = await r.get(f"chipcare:csv:{body.dispatch_id}")
    await r.aclose()
    if not csv_bytes:
        raise HTTPException(400, "CSV expirou (1h). Faça upload novamente.")
    if csv_bytes.startswith(b"\xef\xbb\xbf"):
        csv_bytes = csv_bytes[3:]

    channel_ids = [a.channel_id for a in body.assignments]
    template_payload = build_template_payload(
        template_name=body.template.template_name,
        template_id=body.template.template_id,
        language_code=body.template.language_code,
        components=body.template.components,
    )

    campaign_name = body.campaign_name or f"Acelera_{body.dispatch_id[:8]}"

    if body.dry_run:
        return {
            "dry_run": True,
            "campaign_name": campaign_name,
            "channel_ids": channel_ids,
            "total_leads": dispatch.data[0]["total_leads"],
            "template": body.template.template_name,
            "aggression_level": body.aggression_level,
        }

    client, row = _get_client_and_settings(user_id)
    try:
        jwt = await client.login(tenant_id=row.get("tenant_id"))
    except Exception as e:
        raise HTTPException(502, f"Login Chipcare falhou: {e}")

    # Convert CSV to XLSX for upload
    xlsx_bytes = None
    if body.source_type == "XLSX_FILE":
        xlsx_bytes = csv_to_xlsx_bytes(csv_bytes)

    try:
        result = await client.create_campaign(
            jwt=jwt,
            name=campaign_name,
            channel_ids=channel_ids,
            template=template_payload,
            source_type=body.source_type,
            chat_status=body.chat_status,
            channel_mode=body.channel_mode,
            min_interval_ms=body.min_interval_ms,
            max_interval_ms=body.max_interval_ms,
            aggression_level=body.aggression_level,
            xlsx_bytes=xlsx_bytes,
            dry_run=False,
        )
    except Exception as e:
        log.exception("chipcare create_campaign error: %s", e)
        raise HTTPException(502, f"Chipcare create_campaign falhou: {e}")

    chipcare_campaign_id = result.get("campaign_id")

    # Activate immediately if requested
    activated = False
    if body.activate_immediately and chipcare_campaign_id:
        try:
            await client.activate_campaign(jwt, chipcare_campaign_id)
            activated = True
        except Exception as e:
            log.warning("chipcare activate_campaign error (campaign created but not activated): %s", e)

    now = datetime.now(timezone.utc).isoformat()
    db.table("chipcare_dispatches").update({
        "status": "running" if activated else "paused",
        "chipcare_campaign_id": chipcare_campaign_id,
        "campaign_name": campaign_name,
        "channel_ids": channel_ids,
        "template_name": body.template.template_name,
        "template_id": body.template.template_id,
        "aggression_level": body.aggression_level,
        "source_type": body.source_type,
        "assignments_json": [a.dict() for a in body.assignments],
        "updated_at": now,
    }).eq("id", body.dispatch_id).execute()

    return {
        "dispatch_id": body.dispatch_id,
        "chipcare_campaign_id": chipcare_campaign_id,
        "status": "running" if activated else "paused",
        "activated": activated,
    }


@router.post("/dispatches/{dispatch_id}/activate")
async def activate_dispatch(dispatch_id: str, user_id: str = Depends(_get_user_id)):
    """Ativa campanha Chipcare criada em modo pausado."""
    db = get_db()
    dispatch = db.table("chipcare_dispatches").select("*").eq("id", dispatch_id).eq("owner_id", user_id).execute()
    if not dispatch.data:
        raise HTTPException(404, "Dispatch não encontrado")
    row = dispatch.data[0]
    chipcare_id = row.get("chipcare_campaign_id")
    if not chipcare_id:
        raise HTTPException(400, "Campanha Chipcare não criada ainda")

    client, settings_row = _get_client_and_settings(user_id)
    jwt = await client.login(tenant_id=settings_row.get("tenant_id"))
    await client.activate_campaign(jwt, chipcare_id)

    db.table("chipcare_dispatches").update({
        "status": "running",
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", dispatch_id).execute()
    return {"ok": True, "chipcare_campaign_id": chipcare_id}


@router.post("/dispatches/{dispatch_id}/cancel")
async def cancel_dispatch(dispatch_id: str, user_id: str = Depends(_get_user_id)):
    db = get_db()
    db.table("chipcare_dispatches").update({
        "status": "cancelled",
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", dispatch_id).eq("owner_id", user_id).execute()
    return {"ok": True}


# ── Read endpoints ─────────────────────────────────────────────────────────────

@router.get("/snapshot")
async def get_snapshot(user_id: str = Depends(_get_user_id)):
    db = get_db()
    channels = db.table("chipcare_channels").select("*").eq("owner_id", user_id).execute()
    active = db.table("chipcare_dispatches").select("*").eq("owner_id", user_id).in_("status", ["running", "paused"]).order("created_at", desc=True).limit(10).execute()
    return {
        "channels": channels.data or [],
        "active_dispatches": active.data or [],
    }


@router.get("/dispatches")
async def list_dispatches(user_id: str = Depends(_get_user_id)):
    db = get_db()
    resp = db.table("chipcare_dispatches").select("*").eq("owner_id", user_id).not_.eq("status", "pending_confirm").order("created_at", desc=True).limit(50).execute()
    return resp.data or []


@router.get("/analytics")
async def get_analytics(user_id: str = Depends(_get_user_id)):
    db = get_db()
    resp = db.table("chipcare_dispatches").select(
        "id, campaign_name, total_leads, assignments_json, template_name, status, created_at"
    ).eq("owner_id", user_id).not_.eq("status", "pending_confirm").order("created_at", desc=True).limit(20).execute()
    rows = resp.data or []
    return {
        "campaigns": rows,
        "total_campaigns": len(rows),
        "total_leads": sum(r.get("total_leads") or 0 for r in rows),
    }
