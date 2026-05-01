import json
from fastapi import APIRouter, Request
from ..redis_client import get_redis

router = APIRouter(tags=["webhook"])

@router.post("/webhook")
async def receive_webhook(request: Request):
    payload = await request.json()
    print(f"[webhook] {payload}")

    if payload.get("type") == "private.consignment.consult.updated":
        consult_id = payload.get("consultId")
        if consult_id:
            redis = await get_redis()
            await redis.publish(f"consult:{consult_id}", json.dumps(payload))

    return {"ok": True}
