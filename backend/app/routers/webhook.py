import json
from fastapi import APIRouter, HTTPException, Request
from ..redis_client import get_redis
from ..database import db as get_db
from ..db_scoped import scoped

router = APIRouter(tags=["webhook"])


@router.post("/webhook")
async def receive_webhook(request: Request):
    """Endpoint legado: pubsub via Redis pra polling-loop ouvir."""
    payload = await request.json()
    if payload.get("type") == "private.consignment.consult.updated":
        consult_id = payload.get("consultId")
        if consult_id:
            redis = await get_redis()
            await redis.publish(f"consult:{consult_id}", json.dumps(payload))
    return {"ok": True}


def _build_updates_from_v8_payload(payload: dict) -> dict:
    """Mapeia campos V8 → colunas v8_leads. Atualização leve; o polling
    do worker continua sendo a fonte autoritativa do status final."""
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
async def v8_webhook(payload: dict):
    consult_id = payload.get("consult_id") or payload.get("consultId")
    if not consult_id:
        raise HTTPException(400, "consult_id ausente")

    db = get_db()
    # ÚNICA exceção ao scoped — webhook está no allowlist do lint AST.
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
