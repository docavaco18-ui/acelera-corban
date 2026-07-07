"""Server-side validation of dispatch assignments.

Used by all 3 broadcasters (VendeAI / Aesir / Chipcare) to prevent payload tampering:
- DevTools edits to planned_count above daily_limit
- Sending phone_id/channel_id/instance_id of another tenant
- Duplicate IDs in same dispatch
- Sending paused or disabled numbers
- partial dispatch when allow_partial=False (default)

All functions are pure (no I/O except passed `db`). Raise HTTPException(400) on user errors,
HTTPException(403) on tenant isolation breaches, HTTPException(409) on conflict.

Each validator returns a tuple `(assigned_count, unassigned_count)` so callers can decide
whether to add to response or block.
"""
from __future__ import annotations

from typing import Any, Iterable

from fastapi import HTTPException


# ── Shared helpers ────────────────────────────────────────────────────────────

def _check_planned_integer(planned_raw: Any, ident: str) -> int:
    try:
        planned = int(planned_raw or 0)
    except (ValueError, TypeError):
        raise HTTPException(400, f"planned_count inválido para {ident}: deve ser inteiro")
    if planned < 0:
        raise HTTPException(400, f"planned_count negativo para {ident}: {planned}")
    return planned


def _check_no_duplicates(ids: Iterable[Any], kind: str) -> None:
    seen: set = set()
    for i in ids:
        if i in seen:
            raise HTTPException(409, f"{kind} duplicado em assignments: {i}")
        seen.add(i)


def _check_partial(assigned: int, total: int, allow_partial: bool) -> tuple[int, int]:
    unassigned = max(0, total - assigned)
    if assigned > total:
        raise HTTPException(
            400,
            f"sum(planned_count)={assigned} maior que total_leads={total}. "
            "Reduza distribuição."
        )
    if unassigned > 0 and not allow_partial:
        raise HTTPException(
            400,
            f"Distribuição parcial bloqueada: {assigned} de {total} leads atribuídos "
            f"({unassigned} sobrando). Passe allow_partial=true se intencional."
        )
    return assigned, unassigned


# ── VendeAI validator ─────────────────────────────────────────────────────────

def validate_vendeai_assignments(
    db,
    user_id: str,
    assignments: list[dict],
    total_leads: int,
    allow_partial: bool = False,
) -> tuple[int, int]:
    """Validate VendeAI dispatch assignments against DB state.

    Checks:
    - phone_id exists for owner_id (404 if not)
    - phone is not paused, can_send != DISABLED/BLOCKED
    - planned_count <= daily_limit
    - No duplicate phone_id
    - inbox_id and template_id required if planned>0
    - sum(planned) == total_leads unless allow_partial=True
    """
    if not assignments:
        raise HTTPException(400, "Lista de assignments vazia")

    # Load all numbers for this owner — single query
    nums_resp = db.table("broadcast_numbers") \
        .select("phone_id, daily_limit, is_paused, can_send") \
        .eq("owner_id", user_id) \
        .execute()
    nums_by_id = {n["phone_id"]: n for n in (nums_resp.data or [])}

    assigned_total = 0
    active_phone_ids: list[str] = []
    for asn in assignments:
        phone_id = asn.get("phone_id", "")
        planned = _check_planned_integer(asn.get("planned_count"), f"phone {phone_id}")
        if planned <= 0:
            continue
        if not phone_id:
            raise HTTPException(400, "phone_id ausente em assignment")
        if phone_id not in nums_by_id:
            raise HTTPException(404, f"phone_id {phone_id} não pertence a este owner")
        num = nums_by_id[phone_id]
        if num.get("is_paused"):
            raise HTTPException(400, f"phone {phone_id} está pausado")
        if (num.get("can_send") or "").upper() in ("DISABLED", "BLOCKED"):
            raise HTTPException(400, f"phone {phone_id} can_send={num.get('can_send')} — bloqueado")
        limit = int(num.get("daily_limit") or 500)
        if planned > limit:
            raise HTTPException(
                400,
                f"planned_count={planned} excede daily_limit={limit} para phone {phone_id}"
            )
        if not asn.get("inbox_id") or not asn.get("template_id"):
            raise HTTPException(
                400,
                f"inbox_id e template_id obrigatórios para phone {phone_id} (planned>0)"
            )
        assigned_total += planned
        active_phone_ids.append(phone_id)

    _check_no_duplicates(active_phone_ids, "phone_id")
    return _check_partial(assigned_total, total_leads, allow_partial)


# ── Aesir validator ───────────────────────────────────────────────────────────

def validate_aesir_assignments(
    db,
    user_id: str,
    assignments: list[Any],  # AssignmentIn or dict
    total_leads: int,
    allow_partial: bool = False,
) -> tuple[int, int]:
    """Validate Aesir dispatch assignments against DB state.

    `assignments` can be list[AssignmentIn] (Pydantic) or list[dict].
    """
    if not assignments:
        raise HTTPException(400, "Lista de assignments vazia")

    inst_resp = db.table("aesir_instances") \
        .select("instance_id, daily_limit, is_paused, can_send, quality_rating, status") \
        .eq("owner_id", user_id) \
        .execute()
    inst_by_id = {i["instance_id"]: i for i in (inst_resp.data or [])}

    assigned_total = 0
    active_ids: list[str] = []
    for asn in assignments:
        # Support pydantic and dict
        iid = getattr(asn, "instance_id", None) or (asn.get("instance_id") if isinstance(asn, dict) else None)
        planned_raw = getattr(asn, "planned_count", None) if not isinstance(asn, dict) else asn.get("planned_count")
        planned = _check_planned_integer(planned_raw, f"instance {iid}")
        if planned <= 0:
            continue
        if not iid:
            raise HTTPException(400, "instance_id ausente em assignment")
        if iid not in inst_by_id:
            raise HTTPException(404, f"instance_id {iid} não pertence a este owner")
        inst = inst_by_id[iid]
        if inst.get("is_paused"):
            raise HTTPException(400, f"instance {iid} está pausada")
        if (inst.get("status") or "") == "meta-only":
            raise HTTPException(400, f"instance {iid} é meta-only (sem canal Aesir)")
        if (inst.get("can_send") or "").upper() in ("DISABLED", "BLOCKED"):
            raise HTTPException(400, f"instance {iid} can_send={inst.get('can_send')} — bloqueado")
        if (inst.get("quality_rating") or "").upper() == "RED":
            raise HTTPException(400, f"instance {iid} qualidade RED — bloqueado")
        limit = int(inst.get("daily_limit") or 500)
        if planned > limit:
            raise HTTPException(
                400,
                f"planned_count={planned} excede daily_limit={limit} para instance {iid}"
            )
        assigned_total += planned
        active_ids.append(iid)

    _check_no_duplicates(active_ids, "instance_id")
    return _check_partial(assigned_total, total_leads, allow_partial)


# ── Chipcare validator ────────────────────────────────────────────────────────

def validate_chipcare_assignments(
    db,
    user_id: str,
    assignments: list[Any],
    total_leads: int,
    allow_partial: bool = False,
) -> tuple[int, int]:
    """Validate Chipcare dispatch assignments against DB state.

    Rejects meta-only channels (channel_id < 0), offline, paused, and over-capacity.
    """
    if not assignments:
        raise HTTPException(400, "Lista de assignments vazia")

    ch_resp = db.table("chipcare_channels") \
        .select("channel_id, daily_limit, is_paused, status, channel_type, quality_rating, can_send") \
        .eq("owner_id", user_id) \
        .execute()
    ch_by_id = {c["channel_id"]: c for c in (ch_resp.data or [])}

    assigned_total = 0
    active_ids: list[int] = []
    for asn in assignments:
        cid = getattr(asn, "channel_id", None) if not isinstance(asn, dict) else asn.get("channel_id")
        planned_raw = getattr(asn, "planned_count", None) if not isinstance(asn, dict) else asn.get("planned_count")
        planned = _check_planned_integer(planned_raw, f"channel {cid}")
        if planned <= 0:
            continue
        if cid is None:
            raise HTTPException(400, "channel_id ausente em assignment")
        if cid < 0:
            raise HTTPException(400, f"channel {cid} é meta-only — sem canal Chipcare real")
        if cid not in ch_by_id:
            raise HTTPException(404, f"channel_id {cid} não pertence a este owner")
        ch = ch_by_id[cid]
        if ch.get("is_paused"):
            raise HTTPException(400, f"channel {cid} está pausado")
        status = (ch.get("status") or "").upper()
        if status not in ("CONNECTED", "ONLINE"):
            raise HTTPException(400, f"channel {cid} status={ch.get('status')} — não conectado")
        quality = (ch.get("quality_rating") or "").upper()
        if quality == "RED":
            raise HTTPException(400, f"channel {cid} com qualidade RED — disparo bloqueado (risco de ban)")
        can_send = (ch.get("can_send") or "").upper()
        if can_send in ("DISABLED", "BLOCKED"):
            raise HTTPException(400, f"channel {cid} com envio bloqueado pela Meta (can_send={ch.get('can_send')})")
        limit = int(ch.get("daily_limit") or 500)
        if planned > limit:
            raise HTTPException(
                400,
                f"planned_count={planned} excede daily_limit={limit} para channel {cid}"
            )
        assigned_total += planned
        active_ids.append(cid)

    _check_no_duplicates(active_ids, "channel_id")
    return _check_partial(assigned_total, total_leads, allow_partial)
