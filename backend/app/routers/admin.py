"""Endpoints de administração de usuários (somente admin).

Usa a Service Role Key do Supabase para chamar a Admin API:
- POST /api/admin/users          → cria usuário (email + senha)
- GET  /api/admin/users          → lista usuários
- PATCH /api/admin/users/{id}    → atualiza (banido/role)
- DELETE /api/admin/users/{id}   → remove
"""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..auth_deps import require_admin, AuthUser
from ..config import settings
from ..database import db as get_db

router = APIRouter(prefix="/api/admin", tags=["admin"])


def _admin_headers() -> dict[str, str]:
    return {
        "apikey": settings.supabase_service_key,
        "Authorization": f"Bearer {settings.supabase_service_key}",
        "Content-Type": "application/json",
    }


def _admin_url(path: str = "") -> str:
    return f"{settings.supabase_url.rstrip('/')}/auth/v1/admin/users{path}"


class CreateUserBody(BaseModel):
    email: str
    password: str
    role: str = "user"  # "user" | "admin"


class UpdateUserBody(BaseModel):
    role: str | None = None
    banned: bool | None = None
    password: str | None = None


@router.post("/users")
async def create_user(body: CreateUserBody, _: AuthUser = Depends(require_admin)):
    payload = {
        "email": body.email,
        "password": body.password,
        "email_confirm": True,
        "app_metadata": {"role": body.role},
    }
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.post(_admin_url(), headers=_admin_headers(), json=payload)
    if not r.is_success:
        raise HTTPException(r.status_code, r.text)
    return r.json()


@router.get("/users")
async def list_users(_: AuthUser = Depends(require_admin)):
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.get(_admin_url() + "?per_page=200", headers=_admin_headers())
    if not r.is_success:
        raise HTTPException(r.status_code, r.text)
    data = r.json()
    users = data.get("users") if isinstance(data, dict) else data
    return {"users": users or []}


@router.patch("/users/{user_id}")
async def update_user(
    user_id: str,
    body: UpdateUserBody,
    _: AuthUser = Depends(require_admin),
):
    payload: dict = {}
    if body.role is not None:
        payload["app_metadata"] = {"role": body.role}
    if body.banned is True:
        payload["ban_duration"] = "876000h"  # 100 anos
    if body.banned is False:
        payload["ban_duration"] = "none"
    if body.password:
        payload["password"] = body.password
    if not payload:
        raise HTTPException(400, "Nada para atualizar")

    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.put(_admin_url(f"/{user_id}"), headers=_admin_headers(), json=payload)
    if not r.is_success:
        raise HTTPException(r.status_code, r.text)
    return r.json()


@router.get("/runs")
async def list_all_runs(limit: int = 50, _: AuthUser = Depends(require_admin)):
    """Histórico de runs de todos os usuários (V8 + VCTex) para o admin."""
    db = get_db()
    v8 = (
        db.table("v8_bot_runs")
        .select("id,owner_id,started_at,finished_at,status,num_workers,total_processed,total_elegiveis,total_inelegiveis")
        .order("started_at", desc=True)
        .limit(limit)
        .execute().data or []
    )
    vctex = (
        db.table("vctex_bot_runs")
        .select("id,owner_id,started_at,finished_at,status,num_workers,total_processed,total_elegiveis,total_inelegiveis")
        .order("started_at", desc=True)
        .limit(limit)
        .execute().data or []
    )
    merged = sorted(
        [{**r, "bank": "v8"} for r in v8] + [{**r, "bank": "vctex"} for r in vctex],
        key=lambda x: x.get("started_at") or "",
        reverse=True,
    )[:limit]
    return {"runs": merged}


@router.get("/overview")
async def overview(_: AuthUser = Depends(require_admin)):
    """Dashboard cross-banco: usuários ativos, bots rodando, disparos e runs recentes."""
    db = get_db()
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    last_24h = (now - timedelta(hours=24)).isoformat()

    # ── 1. Usuários (via Supabase Admin API) ──────────────────────────────────
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.get(_admin_url() + "?per_page=200", headers=_admin_headers())
    all_users = (r.json().get("users") or []) if r.is_success else []
    active_today = [
        {"id": u["id"], "email": u["email"], "last_sign_in_at": u.get("last_sign_in_at")}
        for u in all_users
        if u.get("last_sign_in_at") and u["last_sign_in_at"] >= last_24h
    ]

    # ── 2. Bots rodando agora ─────────────────────────────────────────────────
    bot_tables = [
        ("v8", "v8_bot_runs"),
        ("vctex", "vctex_bot_runs"),
        ("mercantil", "mercantil_bot_runs"),
        ("presenca", "presenca_bot_runs"),
        ("powerhub", "powerhub_bot_runs"),
    ]

    def _query_bots():
        rows = []
        for bank, table in bot_tables:
            try:
                data = (
                    db.table(table)
                    .select("id,owner_id,started_at,num_workers")
                    .eq("status", "running")
                    .execute().data or []
                )
                for r in data:
                    rows.append({**r, "bank": bank})
            except Exception:
                pass
        return rows

    # ── 3. Disparos hoje ──────────────────────────────────────────────────────
    dispatch_tables = [
        ("vendeai", "broadcast_dispatches"),
        ("chipcare", "chipcare_dispatches"),
        ("aesir", "aesir_dispatches"),
    ]

    def _query_dispatches():
        rows = []
        for source, table in dispatch_tables:
            try:
                data = (
                    db.table(table)
                    .select("id,owner_id,status,total_leads,created_at")
                    .gte("created_at", today_start)
                    .execute().data or []
                )
                for r in data:
                    rows.append({**r, "source": source})
            except Exception:
                pass
        return rows

    # ── 4. Runs recentes (todos os bancos) ────────────────────────────────────
    def _query_recent_runs():
        all_runs = []
        for bank, table in bot_tables:
            try:
                data = (
                    db.table(table)
                    .select("id,owner_id,started_at,finished_at,status,num_workers,total_processed,total_elegiveis,total_inelegiveis")
                    .order("started_at", desc=True)
                    .limit(15)
                    .execute().data or []
                )
                for r in data:
                    all_runs.append({**r, "bank": bank})
            except Exception:
                pass
        all_runs.sort(key=lambda x: x.get("started_at") or "", reverse=True)
        return all_runs[:40]

    bots_running, dispatches_today, recent_runs = await asyncio.gather(
        asyncio.to_thread(_query_bots),
        asyncio.to_thread(_query_dispatches),
        asyncio.to_thread(_query_recent_runs),
    )

    total_leads_today = sum(d.get("total_leads") or 0 for d in dispatches_today)
    active_dispatches = sum(1 for d in dispatches_today if d["status"] in ("dispatching", "running"))

    return {
        "users": {
            "total": len(all_users),
            "active_today": len(active_today),
            "active_list": active_today,
        },
        "bots": {
            "running": len(bots_running),
            "list": bots_running,
        },
        "dispatches": {
            "today_total": len(dispatches_today),
            "today_active": active_dispatches,
            "today_leads": total_leads_today,
            "list": dispatches_today,
        },
        "recent_runs": recent_runs,
    }


@router.delete("/users/{user_id}")
async def delete_user(user_id: str, _: AuthUser = Depends(require_admin)):
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.delete(_admin_url(f"/{user_id}"), headers=_admin_headers())
    if r.status_code not in (200, 204):
        raise HTTPException(r.status_code, r.text)
    return {"status": "deleted"}
