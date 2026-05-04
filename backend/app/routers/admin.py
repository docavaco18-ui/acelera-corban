"""Endpoints de administração de usuários (somente admin).

Usa a Service Role Key do Supabase para chamar a Admin API:
- POST /api/admin/users          → cria usuário (email + senha)
- GET  /api/admin/users          → lista usuários
- PATCH /api/admin/users/{id}    → atualiza (banido/role)
- DELETE /api/admin/users/{id}   → remove
"""
from __future__ import annotations

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


@router.delete("/users/{user_id}")
async def delete_user(user_id: str, _: AuthUser = Depends(require_admin)):
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.delete(_admin_url(f"/{user_id}"), headers=_admin_headers())
    if r.status_code not in (200, 204):
        raise HTTPException(r.status_code, r.text)
    return {"status": "deleted"}
