import hashlib
import hmac
import json
import os
from typing import Optional
from fastapi import APIRouter, Header, HTTPException, Request
from ..redis_client import get_redis
from ..database import db as get_db
from ..db_scoped import scoped

router = APIRouter(tags=["webhook"])


def _verify_v8_signature(raw_body: bytes, signature: Optional[str]) -> None:
    """HMAC-SHA256 fail-closed."""
    secret = os.getenv("V8_WEBHOOK_SECRET")
    if not secret:
        raise HTTPException(503, "Webhook secret não configurado (V8_WEBHOOK_SECRET)")
    if not signature:
        raise HTTPException(401, "X-V8-Signature ausente")
    expected = hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
    sig = signature.removeprefix("sha256=")
    if not hmac.compare_digest(expected, sig):
        raise HTTPException(401, "Assinatura inválida")


@router.post("/webhook")
async def receive_webhook(
    request: Request,
    x_v8_signature: Optional[str] = Header(default=None, alias="X-V8-Signature"),
):
    raw = await request.body()
    _verify_v8_signature(raw, x_v8_signature)
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        raise HTTPException(400, "Body não é JSON válido")
    if payload.get("type") == "private.consignment.consult.updated":
        consult_id = payload.get("consultId")
        if consult_id:
            redis = await get_redis()
            await redis.publish(f"consult:{consult_id}", json.dumps(payload))
    return {"ok": True}


def _build_updates_from_v8_payload(payload: dict) -> dict:
    updates: dict = {}
    status = payload.get("status")
    if status == "SUCCESS":
        margin = payload.get("marginBaseValue") or payload.get("availableMarginValue")
        if margin is not None:
            updates["margem_disponivel"] = float(margin)
    elif status in ("REJECTED", "FAILED", "ERROR"):
        updates["status"] = "inelegivel"
        updates["erro"] = payload.get("description") or status
    return updates


@router.post("/api/webhook/v8")
async def v8_webhook(
    request: Request,
    x_v8_signature: Optional[str] = Header(default=None, alias="X-V8-Signature"),
):
    raw = await request.body()
    _verify_v8_signature(raw, x_v8_signature)
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        raise HTTPException(400, "Body não é JSON válido")
    consult_id = payload.get("consult_id") or payload.get("consultId")
    if not consult_id:
        raise HTTPException(400, "consult_id ausente")

    db = get_db()
    resp = (
        db.table("v8_leads")
        .select("id, owner_id")
        .eq("consult_id", consult_id)
        .maybe_single()
        .execute()
    )
    row = resp.data if resp else None
    if not row:
        return {"ok": True, "matched": False}

    updates = _build_updates_from_v8_payload(payload)
    if updates:
        scoped(db, "v8_leads", row["owner_id"]).update(updates).eq("id", row["id"]).execute()
    return {"ok": True, "matched": True}
