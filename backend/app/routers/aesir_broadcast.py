from __future__ import annotations

import asyncio
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from app.credentials.crypto import encrypt, safe_decrypt
from app.database import get_db
from app.services.broadcast.aesir_client import AesirClient

router = APIRouter(prefix="/api/aesir-broadcast", tags=["aesir-broadcast"])
security = HTTPBearer()

# stop events keyed by dispatch_id
_stop_events: dict[str, asyncio.Event] = {}
# strong refs to background tasks so GC doesn't collect them mid-run
_bg_tasks: set[asyncio.Task] = set()


def _get_user_id(credentials: HTTPAuthorizationCredentials = Depends(security)) -> str:
    db = get_db()
    try:
        resp = db.auth.get_user(credentials.credentials)
        return resp.user.id
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")


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


# ── Credentials ───────────────────────────────────────────────────────────────

class AesirCredsIn(BaseModel):
    api_token: str
    account_id: str


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


@router.get("/credentials")
async def get_credentials(user_id: str = Depends(_get_user_id)):
    db = get_db()
    resp = db.table("aesir_settings").select("owner_id, account_id, updated_at").eq("owner_id", user_id).execute()
    if not resp.data:
        return {"configured": False}
    row = resp.data[0]
    return {"configured": True, "account_id": row["account_id"], "updated_at": row["updated_at"]}


# ── Instances ─────────────────────────────────────────────────────────────────

@router.get("/instances")
async def list_instances(user_id: str = Depends(_get_user_id)):
    """Fetch instances from Aesir API and sync to DB."""
    client = _get_client(user_id)
    db = get_db()
    try:
        instances = await client.list_instances()
    except Exception as e:
        raise HTTPException(502, f"Aesir API error: {e}")

    # Upsert to aesir_instances
    for inst in instances:
        iid = str(inst.get("id") or inst.get("instance_id") or "")
        if not iid:
            continue
        db.table("aesir_instances").upsert({
            "owner_id": user_id,
            "instance_id": iid,
            "name": inst.get("name") or inst.get("instance_name") or iid,
            "phone": inst.get("phone") or inst.get("phone_number") or "",
            "status": inst.get("status") or inst.get("connection_status") or "unknown",
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }, on_conflict="owner_id,instance_id").execute()

    # Return from DB (includes is_paused, daily_limit)
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


# ── Dispatch ──────────────────────────────────────────────────────────────────

@router.post("/dispatch")
async def start_dispatch(
    file: UploadFile = File(...),
    instance_id: str = Form(""),
    message_tpl: str = Form(""),
    phone_column: str = Form("telefone"),
    cooldown_seconds: int = Form(5),
    user_id: str = Depends(_get_user_id),
):
    if not instance_id:
        raise HTTPException(400, "instance_id obrigatório")
    if not message_tpl:
        raise HTTPException(400, "message_tpl obrigatório")

    # Check instance not paused
    db = get_db()
    inst_row = db.table("aesir_instances").select("is_paused").eq("owner_id", user_id).eq("instance_id", instance_id).execute()
    if inst_row.data and inst_row.data[0].get("is_paused"):
        raise HTTPException(400, "Instância pausada")

    csv_bytes = await file.read()
    dispatch_id = str(uuid.uuid4())

    # Register dispatch
    db.table("aesir_dispatches").insert({
        "id": dispatch_id,
        "owner_id": user_id,
        "instance_id": instance_id,
        "csv_filename": file.filename,
        "message_tpl": message_tpl,
        "status": "running",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }).execute()

    stop_event = asyncio.Event()
    _stop_events[dispatch_id] = stop_event

    client = _get_client(user_id)

    async def _run():
        try:
            result = await client.dispatch_csv(
                csv_bytes=csv_bytes,
                instance_id=instance_id,
                message_tpl=message_tpl,
                phone_column=phone_column,
                cooldown_seconds=cooldown_seconds,
                stop_event=stop_event,
            )
            final_status = "done" if not stop_event.is_set() else "paused"
            db.table("aesir_dispatches").update({
                "status": final_status,
                "sent": result["sent"],
                "errors": result["errors"],
                "total_contacts": result["total"],
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", dispatch_id).execute()
        except Exception as exc:
            db.table("aesir_dispatches").update({
                "status": "error",
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }).eq("id", dispatch_id).execute()
            raise exc
        finally:
            _stop_events.pop(dispatch_id, None)
            _bg_tasks.discard(task)

    task = asyncio.create_task(_run())
    _bg_tasks.add(task)
    return {"dispatch_id": dispatch_id, "status": "running"}


@router.post("/dispatch/{dispatch_id}/pause")
async def pause_dispatch(dispatch_id: str, user_id: str = Depends(_get_user_id)):
    ev = _stop_events.get(dispatch_id)
    if ev:
        ev.set()
    db = get_db()
    db.table("aesir_dispatches").update({"status": "paused", "updated_at": datetime.now(timezone.utc).isoformat()}).eq("id", dispatch_id).eq("owner_id", user_id).execute()
    return {"ok": True}


@router.post("/dispatch/{dispatch_id}/resume")
async def resume_dispatch(dispatch_id: str, user_id: str = Depends(_get_user_id)):
    """Re-queue a paused dispatch as a new background run from the beginning."""
    db = get_db()
    row = db.table("aesir_dispatches").select("*").eq("id", dispatch_id).eq("owner_id", user_id).execute()
    if not row.data:
        raise HTTPException(404, "Dispatch não encontrado")
    d = row.data[0]
    if d["status"] != "paused":
        raise HTTPException(400, "Dispatch não está pausado")
    raise HTTPException(501, "Resume não suportado — inicie um novo disparo com o mesmo CSV")


@router.post("/dispatch/{dispatch_id}/cancel")
async def cancel_dispatch(dispatch_id: str, user_id: str = Depends(_get_user_id)):
    ev = _stop_events.get(dispatch_id)
    if ev:
        ev.set()
    db = get_db()
    db.table("aesir_dispatches").update({"status": "cancelled", "updated_at": datetime.now(timezone.utc).isoformat()}).eq("id", dispatch_id).eq("owner_id", user_id).execute()
    return {"ok": True}


@router.get("/dispatches")
async def list_dispatches(user_id: str = Depends(_get_user_id)):
    db = get_db()
    resp = db.table("aesir_dispatches").select("*").eq("owner_id", user_id).order("created_at", desc=True).limit(50).execute()
    return resp.data or []
