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
import hashlib
import io
import logging
import re
import uuid
from datetime import datetime, timezone

import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from app.config import settings
from app.credentials.crypto import encrypt, safe_decrypt
from app.database import get_db
from app.services.broadcast.assignment_validator import _dispatch_sent_today, validate_chipcare_assignments
from app.services.broadcast.chipcare_client import (
    ChipcareClient,
    ChipcareHashes,
    build_template_payload,
    csv_to_xlsx_bytes,
)
from app.services.broadcast.meta_client import MetaClient

import time as _time

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/chipcare-broadcast", tags=["chipcare-broadcast"])

# Segura ref forte das tasks de disparo Chipcare em background (senão GC cancela).
_BG_CHIPCARE_TASKS: set = set()
security = HTTPBearer()

# JWT cache: user_id → (jwt_token, expires_at_epoch). TTL 60min (conservative under Chipcare's ~2h lifetime).
_jwt_cache: dict[str, tuple[str, float]] = {}
_JWT_TTL = 3600.0


def _get_cached_jwt(user_id: str) -> str | None:
    entry = _jwt_cache.get(user_id)
    if entry and _time.monotonic() < entry[1]:
        return entry[0]
    _jwt_cache.pop(user_id, None)
    return None


def _set_cached_jwt(user_id: str, jwt: str) -> None:
    _jwt_cache[user_id] = (jwt, _time.monotonic() + _JWT_TTL)


def _invalidate_jwt(user_id: str) -> None:
    _jwt_cache.pop(user_id, None)


# ── Auth helpers ──────────────────────────────────────────────────────────────

from app.auth_deps import verify_token


def _get_user_id(credentials: HTTPAuthorizationCredentials = Depends(security)) -> str:
    # Validação LOCAL do JWT (JWKS/HS256, chaves cacheadas) — sem round-trip de
    # rede ao Supabase Auth por request. Mesmo caminho dos routers de banco.
    return verify_token(credentials.credentials).user_id


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


def _tier_and_limit(meta_tier, meta_limit, prev_tier, prev_limit) -> tuple[str, int]:
    """Regra VendeAI (16-18/06): tier null → 'aguardando Meta' + capacidade 0.
    NUNCA fabrica 500/dia. Preserva o último tier REAL conhecido (tem dígito)
    quando a Meta falha só nesta rodada."""
    if meta_tier:
        return str(meta_tier), int(meta_limit or 0)
    prev_t = str(prev_tier or "")
    if any(c.isdigit() for c in prev_t) and "aguardando" not in prev_t:
        return prev_t, int(prev_limit or 0)
    return "aguardando Meta", 0


def _phone_key_from_title(title: str) -> str:
    """Extrai o telefone do título do canal: primeiro bloco contíguo de 10-13
    dígitos (ignorando separadores comuns). Dígito extra solto depois do número
    (ex.: 'Canal 9999-9999 (2)') não contamina mais a chave."""
    compact = re.sub(r"[\s\-\(\)\.\+]", "", title or "")
    m = re.search(r"\d{10,13}", compact)
    if not m:
        return ""
    return m.group(0)[-10:]


def _advise_split(channels: list[dict], total_leads: int) -> dict:
    """Distribute leads proportionally across eligible official channels."""
    def _remaining(ch: dict) -> int:
        # limite RESTANTE do dia — sem fabricar 500 quando a Meta não reportou tier
        return max(0, int(ch.get("daily_limit") or 0) - int(ch.get("sent_today") or 0))

    def is_eligible(ch: dict) -> bool:
        if ch.get("is_paused"):
            return False
        if ch.get("status") not in ("CONNECTED", "Online", "ONLINE", "online"):
            return False
        if (ch.get("quality_rating") or "").upper() == "RED":
            return False
        if (ch.get("can_send") or "").upper() in ("BLOCKED", "DISABLED"):
            return False
        if _remaining(ch) <= 0:
            return False
        return True

    active = [c for c in channels if is_eligible(c)]
    excluded = [c for c in channels if not is_eligible(c)]

    if not active:
        return {
            "assignments": [],
            "justification": "Nenhum canal Chipcare elegível.",
            "risks": "Verifique se há canais Oficial conectados, com qualidade OK e capacidade confirmada pela Meta.",
        }

    total_capacity = sum(_remaining(c) for c in active)
    remaining = total_leads
    assignments = []

    for idx, ch in enumerate(active):
        limit = _remaining(ch)
        if idx == len(active) - 1:
            planned = min(remaining, limit)
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
def save_credentials(body: ChipcareCredsIn, user_id: str = Depends(_get_user_id)):
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


import re as _re

_SA_HASH_RE = _re.compile(r'^[0-9a-f]{40,}$', _re.IGNORECASE)


@router.post("/sa-hashes")
def update_sa_hashes(body: SaHashesIn, user_id: str = Depends(_get_user_id)):
    """Atualizar hashes SA quando Chipcare fizer deploy e os hashes mudarem."""
    db = get_db()
    patch: dict = {}
    for k, v in body.dict().items():
        if not v:
            continue
        if not _SA_HASH_RE.match(v):
            raise HTTPException(400, f"Hash SA inválido '{k}': deve ter 40+ caracteres hex (got {len(v)} chars)")
        patch[k] = v
    if not patch:
        raise HTTPException(400, "Nenhum hash fornecido")
    patch["updated_at"] = datetime.now(timezone.utc).isoformat()
    db.table("chipcare_settings").update(patch).eq("owner_id", user_id).execute()
    return {"ok": True, "updated": list(patch.keys())}


@router.get("/credentials")
def get_credentials(user_id: str = Depends(_get_user_id)):
    db = get_db()
    resp = db.table("chipcare_settings").select(
        "owner_id, tenant_id, sa_create, sa_activate, meta_token_enc, waba_ids, updated_at"
    ).eq("owner_id", user_id).execute()
    if not resp.data:
        return {"configured": False, "meta_configured": False, "waba_ids": []}
    row = resp.data[0]
    return {
        "configured": True,
        "tenant_id": row.get("tenant_id"),
        "sa_create": (row.get("sa_create") or "")[:8] + "...",
        "sa_activate": (row.get("sa_activate") or "")[:8] + "...",
        "meta_configured": bool(row.get("meta_token_enc")),
        "waba_ids": row.get("waba_ids") or [],
        "updated_at": row["updated_at"],
    }


class MetaCredsIn(BaseModel):
    meta_token: str
    waba_ids: list[str] = []


@router.post("/meta-credentials")
def save_meta_credentials(body: MetaCredsIn, user_id: str = Depends(_get_user_id)):
    """Salva token Meta System User + opcional lista de WABA IDs (regra padrão dos 3 disparadores)."""
    db = get_db()
    existing = db.table("chipcare_settings").select("owner_id").eq("owner_id", user_id).execute()
    if not existing.data:
        raise HTTPException(400, "Configure as credenciais Chipcare (email/senha) antes de salvar o token Meta")
    payload = {
        "meta_token_enc": encrypt(body.meta_token.strip()),
        "waba_ids": [w.strip() for w in body.waba_ids if w.strip()],
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    db.table("chipcare_settings").update(payload).eq("owner_id", user_id).execute()
    return {"ok": True}


# ── Channels ──────────────────────────────────────────────────────────────────

@router.post("/refresh-channels")
async def refresh_channels(user_id: str = Depends(_get_user_id)):
    """Pattern Aesir/VendeAI: Chipcare + Meta independentes, erros não-fatais, response sempre 200.

    Cross-reference channels Chipcare ↔ phones Meta pelo last10digits do título do canal.
    Números Meta sem match são salvos como `channel_id < 0` (meta-only) pra aparecer no UI.
    """
    db = get_db()
    row_resp = db.table("chipcare_settings").select("*").eq("owner_id", user_id).execute()
    if not row_resp.data:
        raise HTTPException(400, "Configure credenciais primeiro")
    row = row_resp.data[0]

    meta_token = safe_decrypt(row.get("meta_token_enc") or "")
    chipcare_email = safe_decrypt(row.get("email_enc") or "")
    chipcare_pass = safe_decrypt(row.get("password_enc") or "")
    waba_ids: list[str] = row.get("waba_ids") or []

    if not chipcare_email and not meta_token:
        raise HTTPException(400, "Configure ao menos um token (Chipcare ou Meta) antes de sincronizar.")

    # ── Step 1: Meta discovery (independente do Chipcare) ────────────────────
    meta_error: str | None = None
    meta_phones_list: list[dict] = []
    meta_phones_by_key: dict[str, dict] = {}
    if meta_token:
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

            for p in meta_phones_list:
                raw = "".join(c for c in (p.get("display_phone") or "") if c.isdigit())
                key = raw[-10:] if len(raw) >= 10 else raw
                if key:
                    meta_phones_by_key[key] = p
        except Exception as e:
            meta_error = str(e)

    # ── Step 2: Chipcare channels (não-fatal) ────────────────────────────────
    channels: list[dict] = []
    chipcare_error: str | None = None
    if not chipcare_email or not chipcare_pass:
        chipcare_error = "Credenciais Chipcare não configuradas — modo Meta-only ativo"
    else:
        try:
            client, _ = _get_client_and_settings(user_id)
            jwt = await client.login(tenant_id=row.get("tenant_id"))
            _set_cached_jwt(user_id, jwt)
            if client._user_id:
                db.table("chipcare_settings").update(
                    {"chipcare_user_id": client._user_id}
                ).eq("owner_id", user_id).execute()
            channels = await client.list_channels(jwt)
        except Exception as e:
            chipcare_error = str(e)
            _invalidate_jwt(user_id)

    # ── Step 3: Upsert Chipcare channels cruzados com Meta ──────────────────
    now = datetime.now(timezone.utc).isoformat()
    _prev_rows = db.table("chipcare_channels").select("phone_id,daily_limit,messaging_tier").eq("owner_id", user_id).execute().data or []
    _prev_limit = {r.get("phone_id"): r.get("daily_limit") for r in _prev_rows if r.get("phone_id")}
    _prev_tier = {r.get("phone_id"): r.get("messaging_tier") for r in _prev_rows if r.get("phone_id")}
    matched_keys: set[str] = set()
    seen_ids: set[int] = set()
    for ch in channels:
        cid = ch.get("id")
        if not cid:
            continue
        seen_ids.add(int(cid))
        title = ch.get("title") or str(cid)
        key = _phone_key_from_title(title)
        meta_q = meta_phones_by_key.get(key, {}) if key else {}
        if key and meta_q:
            matched_keys.add(key)

        payload: dict = {
            "owner_id": user_id,
            "channel_id": int(cid),
            "title": title,
            "status": ch.get("status") or "CLOSED",
            "channel_type": ch.get("channelType") or "WHATSAPP_OFFICIAL",
            "description": ch.get("description") or "",
            "updated_at": now,
        }
        if meta_q:
            _tier, _limit = _tier_and_limit(
                meta_q.get("messaging_tier"), meta_q.get("daily_limit"),
                _prev_tier.get(meta_q.get("phone_id")), _prev_limit.get(meta_q.get("phone_id")),
            )
            payload.update({
                "waba_id": meta_q.get("waba_id"),
                "phone_id": meta_q.get("phone_id"),
                "display_phone": meta_q.get("display_phone"),
                "quality_rating": meta_q.get("quality_rating", "UNKNOWN"),
                "messaging_tier": _tier,
                "can_send": meta_q.get("can_send", "UNKNOWN"),
                "verified_name": meta_q.get("verified_name"),
                "name_status": meta_q.get("name_status"),
                "account_mode": meta_q.get("account_mode"),
                "restrictions": meta_q.get("restrictions") or [],
                "additional_info": meta_q.get("additional_info") or [],
                "has_payment_issue": meta_q.get("has_payment_issue", False),
                "display_name_pending": meta_q.get("display_name_pending", False),
                "waba_name": meta_q.get("waba_name"),
                "account_review_status": meta_q.get("account_review_status"),
                "business_verification_status": meta_q.get("business_verification_status"),
                "waba_currency": meta_q.get("waba_currency"),
                "waba_country": meta_q.get("waba_country"),
                "daily_limit": _limit,
                "quality_updated_at": now,
            })
        try:
            db.table("chipcare_channels").upsert(payload, on_conflict="owner_id,channel_id").execute()
        except Exception:
            pass

    # ── Step 4: Meta-only phones (sem match Chipcare) — channel_id negativo
    # Permite ver TODAS WABAs da BM mesmo sem Chipcare conectado.
    for p in meta_phones_list:
        raw = "".join(c for c in (p.get("display_phone") or "") if c.isdigit())
        key = raw[-10:] if len(raw) >= 10 else raw
        if not key or key in matched_keys:
            continue
        # Hash determinístico SHA256 (negativo pra não colidir com Chipcare channel_ids positivos).
        # hash() builtin é randomizado per-process → causaria duplicates entre runs.
        try:
            seed = (p.get("phone_id") or key).encode("utf-8")
            digest = hashlib.sha256(seed).digest()
            synth_id = -(int.from_bytes(digest[:6], "big") % 2_000_000_000)
        except Exception:
            continue
        seen_ids.add(synth_id)
        _tier, _limit = _tier_and_limit(
            p.get("messaging_tier"), p.get("daily_limit"),
            _prev_tier.get(p.get("phone_id")), _prev_limit.get(p.get("phone_id")),
        )
        try:
            db.table("chipcare_channels").upsert({
                "owner_id": user_id,
                "channel_id": synth_id,
                "title": p.get("display_phone") or str(synth_id),
                "status": "meta-only",
                "channel_type": "META_ONLY",
                "description": "Número Meta sem canal Chipcare correspondente",
                "waba_id": p.get("waba_id"),
                "phone_id": p.get("phone_id"),
                "display_phone": p.get("display_phone"),
                "quality_rating": p.get("quality_rating", "UNKNOWN"),
                "messaging_tier": _tier,
                "can_send": p.get("can_send", "UNKNOWN"),
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
                "daily_limit": _limit,
                "quality_updated_at": now,
                "updated_at": now,
            }, on_conflict="owner_id,channel_id").execute()
        except Exception:
            pass

    # ── Step 5: Limpa órfãos (BM/CRM trocados) — espelha o Step 4 do VendeAI ──
    # Só quando Chipcare e Meta responderam limpos; falha em qualquer fonte preserva tudo.
    removed = 0
    if chipcare_error is None and meta_error is None and seen_ids:
        all_rows = db.table("chipcare_channels").select("channel_id").eq("owner_id", user_id).execute().data or []
        stale = [r["channel_id"] for r in all_rows if r.get("channel_id") is not None and int(r["channel_id"]) not in seen_ids]
        if stale:
            db.table("chipcare_channels").delete().eq("owner_id", user_id).in_("channel_id", stale).execute()
            removed = len(stale)

    stored = db.table("chipcare_channels").select("*").eq("owner_id", user_id).execute()
    return {
        "ok": True,
        "channels": stored.data or [],
        "count": len(channels),
        "meta_total": len(meta_phones_list),
        "meta_matched": len(matched_keys),
        "removed_stale": removed,
        "chipcare_error": chipcare_error,
        "meta_error": meta_error,
    }


@router.get("/channels")
def list_channels(user_id: str = Depends(_get_user_id)):
    db = get_db()
    resp = db.table("chipcare_channels").select("*").eq("owner_id", user_id).execute()
    return resp.data or []


@router.post("/channels/{channel_id}/pause")
def pause_channel(channel_id: int, user_id: str = Depends(_get_user_id)):
    db = get_db()
    db.table("chipcare_channels").update({"is_paused": True}).eq("owner_id", user_id).eq("channel_id", channel_id).execute()
    return {"ok": True}


@router.post("/channels/{channel_id}/resume")
def resume_channel(channel_id: int, user_id: str = Depends(_get_user_id)):
    db = get_db()
    db.table("chipcare_channels").update({"is_paused": False}).eq("owner_id", user_id).eq("channel_id", channel_id).execute()
    return {"ok": True}


# ── Templates ─────────────────────────────────────────────────────────────────

@router.get("/templates")
async def list_templates(user_id: str = Depends(_get_user_id)):
    """Login no Chipcare + SA getCommonChannelTemplates → retorna templates HSM."""
    db = get_db()
    client, row = _get_client_and_settings(user_id)
    ch_resp = db.table("chipcare_channels").select("channel_id").eq("owner_id", user_id).eq("is_paused", False).execute()
    channel_ids = [r["channel_id"] for r in (ch_resp.data or [])]
    try:
        jwt = _get_cached_jwt(user_id) or await client.login(tenant_id=row.get("tenant_id"))
        _set_cached_jwt(user_id, jwt)
        templates = await client.list_templates(jwt, channel_ids=channel_ids or None)
    except Exception as e:
        _invalidate_jwt(user_id)
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

    # sent_today por canal — split propõe sobre o limite RESTANTE do dia
    sent_map = _dispatch_sent_today(db, user_id, "chipcare_dispatches", "channel_id")
    for ch in channels:
        ch["sent_today"] = sent_map.get(str(ch.get("channel_id")), 0)

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

    try:
        async with aioredis.from_url(settings.redis_url, socket_connect_timeout=5) as r:
            await r.setex(f"chipcare:csv:{user_id}:{dispatch_id}", 3600, csv_bytes)
    except Exception as redis_err:
        db.table("chipcare_dispatches").delete().eq("id", dispatch_id).eq("owner_id", user_id).execute()
        raise HTTPException(503, f"Serviço de cache indisponível. Tente novamente em instantes. ({type(redis_err).__name__})")

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
    dry_run: bool = True  # default true — exige dry_run=false explícito para disparo real
    confirm_real_dispatch: bool = False  # segunda confirmação obrigatória quando dry_run=false
    # Bloqueia disparo se sum(planned_count) != total_leads (default false)
    allow_partial: bool = False


@router.post("/dispatch")
async def confirm_dispatch(body: ChipcareDispatchIn, user_id: str = Depends(_get_user_id)):
    """Cria campanha no Chipcare. dry_run=true para validar sem criar."""
    db = get_db()

    dispatch = db.table("chipcare_dispatches").select("*").eq("id", body.dispatch_id).eq("owner_id", user_id).execute()
    if not dispatch.data:
        raise HTTPException(404, "Dispatch não encontrado")
    if dispatch.data[0]["status"] != "pending_confirm":
        raise HTTPException(400, f"Dispatch já em status {dispatch.data[0]['status']}")

    # Floor anti-tampering: a UI oferece 4 modos (SEGURO/MEDIUM/AGRESSIVO/MAXIMO).
    # Rejeita nível fora da lista e cadência <=0 (edição via DevTools) que viraria
    # rajada sem pacing. Não mexe nos modos legítimos da UI.
    if str(body.aggression_level).upper() not in ("SEGURO", "MEDIUM", "AGRESSIVO", "MAXIMO"):
        body.aggression_level = "MEDIUM"
    body.min_interval_ms = max(250, int(body.min_interval_ms or 0))
    body.max_interval_ms = max(body.min_interval_ms, int(body.max_interval_ms or 0))

    # ── Server-side validation (no tampering, no partial by default) ───────────
    total_leads_for_dispatch = int(dispatch.data[0].get("total_leads") or 0)
    assigned_count, unassigned_count = validate_chipcare_assignments(
        db, user_id, body.assignments, total_leads_for_dispatch, allow_partial=body.allow_partial
    )

    async with aioredis.from_url(settings.redis_url) as r:
        csv_bytes = await r.get(f"chipcare:csv:{user_id}:{body.dispatch_id}")
    if not csv_bytes:
        raise HTTPException(400, "CSV expirou (1h). Faça upload novamente.")
    if csv_bytes.startswith(b"\xef\xbb\xbf"):
        csv_bytes = csv_bytes[3:]

    channel_ids_all = [a.channel_id for a in body.assignments if a.planned_count > 0]
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
            "channel_ids": channel_ids_all,
            "total_leads": dispatch.data[0]["total_leads"],
            "template": body.template.template_name,
            "aggression_level": body.aggression_level,
            "assigned_count": assigned_count,
            "unassigned_count": unassigned_count,
            "campaigns_to_create": len(channel_ids_all),
        }

    if not body.confirm_real_dispatch:
        raise HTTPException(400, "confirm_real_dispatch=true obrigatório para disparo real (dry_run=false)")

    client, row = _get_client_and_settings(user_id)
    try:
        jwt = _get_cached_jwt(user_id) or await client.login(tenant_id=row.get("tenant_id"))
        _set_cached_jwt(user_id, jwt)
    except Exception as e:
        _invalidate_jwt(user_id)
        raise HTTPException(502, f"Login Chipcare falhou: {e}")

    if body.source_type == "XLSX_FILE":
        try:
            import openpyxl  # noqa
        except ImportError:
            raise HTTPException(500, "openpyxl não instalado no servidor — instale: pip install openpyxl")

    # Slice CSV per assignment — each channel gets its own XLSX with only its slice
    csv_text = csv_bytes.decode("utf-8", errors="replace")
    csv_lines = csv_text.splitlines()
    header = csv_lines[0] if csv_lines else ""
    data_rows = csv_lines[1:] if len(csv_lines) > 1 else []

    async def _run():
        try:
            per_assignment: list[dict] = []
            row_offset = 0
            for asn in body.assignments:
                planned = asn.planned_count
                entry: dict = {
                    "channel_id": asn.channel_id,
                    "planned_count": planned,
                    "chipcare_campaign_id": None,
                    "status": "skipped" if planned <= 0 else "pending",
                }
                if planned <= 0:
                    per_assignment.append(entry)
                    continue

                slice_rows = data_rows[row_offset: row_offset + planned]
                row_offset += planned

                slice_xlsx = None
                if body.source_type == "XLSX_FILE":
                    slice_csv = ("\n".join([header] + slice_rows)).encode("utf-8")
                    slice_xlsx = csv_to_xlsx_bytes(slice_csv)

                per_channel_name = f"{campaign_name}_ch{asn.channel_id}" if len(channel_ids_all) > 1 else campaign_name
                try:
                    result = await client.create_campaign(
                        jwt=jwt,
                        name=per_channel_name,
                        channel_ids=[asn.channel_id],
                        template=template_payload,
                        source_type=body.source_type,
                        chat_status=body.chat_status,
                        channel_mode=body.channel_mode,
                        min_interval_ms=body.min_interval_ms,
                        max_interval_ms=body.max_interval_ms,
                        aggression_level=body.aggression_level,
                        xlsx_bytes=slice_xlsx,
                        dry_run=False,
                    )
                    entry["chipcare_campaign_id"] = result.get("campaign_id")
                    entry["status"] = "created" if result.get("campaign_id") else "error"
                    if not result.get("campaign_id"):
                        entry["error"] = "Chipcare não retornou campaign_id"
                except Exception as e:
                    log.exception("chipcare create_campaign per-channel error channel=%s: %s", asn.channel_id, e)
                    entry["status"] = "error"
                    entry["error"] = str(e)[:200]
                per_assignment.append(entry)

            created_ids = [e["chipcare_campaign_id"] for e in per_assignment if e.get("chipcare_campaign_id")]
            if not created_ids:
                db.table("chipcare_dispatches").update({
                    "status": "error",
                    "assignments_json": per_assignment,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }).eq("id", body.dispatch_id).eq("owner_id", user_id).execute()
                return

            # Activate created campaigns if requested
            activated_count = 0
            if body.activate_immediately:
                for entry in per_assignment:
                    cid = entry.get("chipcare_campaign_id")
                    if not cid:
                        continue
                    try:
                        await client.activate_campaign(jwt, cid)
                        entry["status"] = "activated"
                        activated_count += 1
                    except Exception as e:
                        log.warning("chipcare activate per-channel error campaign=%s: %s", cid, e)
                        entry["activation_error"] = str(e)[:200]

            # Determine final status
            target_attempts = len([a for a in body.assignments if a.planned_count > 0])
            if len(created_ids) < target_attempts:
                final_status = "partial_error"
            elif activated_count > 0:
                final_status = "running"
            else:
                final_status = "paused"

            now = datetime.now(timezone.utc).isoformat()
            db.table("chipcare_dispatches").update({
                "status": final_status,
                "chipcare_campaign_id": created_ids[0] if created_ids else None,  # back-compat: first campaign
                "campaign_name": campaign_name,
                "channel_ids": channel_ids_all,
                "template_name": body.template.template_name,
                "template_id": body.template.template_id,
                "aggression_level": body.aggression_level,
                "source_type": body.source_type,
                "assignments_json": per_assignment,
                "updated_at": now,
            }).eq("id", body.dispatch_id).eq("owner_id", user_id).execute()
        except Exception as run_exc:
            log.exception("chipcare dispatch background falhou dispatch=%s: %s", body.dispatch_id, run_exc)
            try:
                db.table("chipcare_dispatches").update({"status": "error", "updated_at": datetime.now(timezone.utc).isoformat()}).eq("id", body.dispatch_id).eq("owner_id", user_id).execute()
            except Exception:
                pass

    # Marca dispatching + roda em BACKGROUND (mesmo motivo do broadcast: o loop
    # create_campaign por canal passa do timeout do Cloudflare -> 502).
    # Transição ATÔMICA pending_confirm→dispatching: evita duplo-submit criar 2 campanhas.
    claim = db.table("chipcare_dispatches").update({"status": "dispatching", "updated_at": datetime.now(timezone.utc).isoformat()}).eq("id", body.dispatch_id).eq("owner_id", user_id).eq("status", "pending_confirm").execute()
    if not claim.data:
        raise HTTPException(409, "Disparo já está sendo processado (duplo-envio evitado).")
    import asyncio as _asyncio
    _task = _asyncio.create_task(_run())
    _BG_CHIPCARE_TASKS.add(_task)
    _task.add_done_callback(_BG_CHIPCARE_TASKS.discard)
    return {
        "dispatch_id": body.dispatch_id,
        "status": "dispatching",
        "assigned_count": assigned_count,
        "unassigned_count": unassigned_count,
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
    try:
        jwt = _get_cached_jwt(user_id) or await client.login(tenant_id=settings_row.get("tenant_id"))
        _set_cached_jwt(user_id, jwt)
        await client.activate_campaign(jwt, chipcare_id)
    except Exception as e:
        _invalidate_jwt(user_id)
        log.exception("chipcare activate_dispatch error dispatch=%s campaign=%s: %s", dispatch_id, chipcare_id, e)
        raise HTTPException(502, f"Chipcare ativar campanha falhou: {e}")

    db.table("chipcare_dispatches").update({
        "status": "running",
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", dispatch_id).eq("owner_id", user_id).execute()
    return {"ok": True, "chipcare_campaign_id": chipcare_id}


@router.post("/dispatches/{dispatch_id}/cancel")
def cancel_dispatch(dispatch_id: str, user_id: str = Depends(_get_user_id)):
    db = get_db()
    existing = db.table("chipcare_dispatches").select("id").eq("id", dispatch_id).eq("owner_id", user_id).execute()
    if not existing.data:
        raise HTTPException(404, "Dispatch não encontrado")
    db.table("chipcare_dispatches").update({
        "status": "cancelled",
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", dispatch_id).eq("owner_id", user_id).execute()
    return {"ok": True}


# ── Read endpoints ─────────────────────────────────────────────────────────────

@router.get("/snapshot")
def get_snapshot(user_id: str = Depends(_get_user_id)):
    db = get_db()
    channels = db.table("chipcare_channels").select("*").eq("owner_id", user_id).execute()
    active = db.table("chipcare_dispatches").select("*").eq("owner_id", user_id).in_("status", ["running", "paused"]).order("created_at", desc=True).limit(10).execute()
    return {
        "channels": channels.data or [],
        "active_dispatches": active.data or [],
    }


@router.get("/dispatches")
def list_dispatches(user_id: str = Depends(_get_user_id)):
    db = get_db()
    resp = db.table("chipcare_dispatches").select("*").eq("owner_id", user_id).not_.eq("status", "pending_confirm").order("created_at", desc=True).limit(50).execute()
    return resp.data or []


@router.get("/analytics")
def get_analytics(user_id: str = Depends(_get_user_id)):
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
