"""Central de Usuários — monitoramento cross-tenant (admin-only).

Roda a engine command_center.compute_overview por usuário e agrega.
"""
from __future__ import annotations

import asyncio
import json
import logging

import httpx
from fastapi import APIRouter, Depends

from ..auth_deps import AuthUser, require_admin
from ..database import get_db
from ..redis_client import get_redis
from .admin import _admin_headers, _admin_url
from .command_center import _collect_settings, compute_overview
from .users_monitor_summary import (
    build_aggregate,
    count_bms,
    error_summary,
    summarize_overview,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/users-monitor", tags=["users-monitor"])

_LIVE_CONCURRENCY = 5
_CACHE_KEY = "admin:users_monitor:snapshot"
_CACHE_TTL = 300  # 5 minutos


async def _list_auth_users() -> list[dict]:
    async with httpx.AsyncClient(timeout=15) as c:
        r = await c.get(_admin_url() + "?per_page=200", headers=_admin_headers())
    if not r.is_success:
        logger.warning("Falha ao listar usuários (Supabase Admin API): %s %s", r.status_code, r.text[:200])
        return []
    data = r.json()
    users = data.get("users") if isinstance(data, dict) else data
    return users or []


def _client_label(db, owner_id: str, email: str | None, settings: dict) -> str:
    try:
        rows = (
            db.table("vendeai_meta_tokens")
            .select("bm_name")
            .eq("owner_id", owner_id)
            .execute().data or []
        )
        for r in rows:
            if r.get("bm_name"):
                return str(r["bm_name"])
    except Exception:
        pass
    return email or owner_id


def _summary_for_user_sync(db, user: dict, live_meta: bool) -> dict:
    """Roda em thread separada (compute_overview usa I/O síncrono que bloqueia o loop)."""
    owner_id = str(user.get("id"))
    email = user.get("email")
    try:
        settings = _collect_settings(db, owner_id)
        loop = asyncio.new_event_loop()
        try:
            overview = loop.run_until_complete(compute_overview(db, owner_id, live_meta=live_meta))
        finally:
            loop.close()
        bms = count_bms(db, owner_id, settings)
        label = _client_label(db, owner_id, email, settings)
        return summarize_overview(overview, owner_id=owner_id, email=email, client_label=label, bms=bms)
    except Exception as e:  # cliente isolado não derruba o painel
        return error_summary(owner_id, email, str(e))


async def _build_all(live_meta: bool) -> dict:
    db = get_db()
    users = await _list_auth_users()
    sem = asyncio.Semaphore(_LIVE_CONCURRENCY)

    async def _bounded(u: dict) -> dict:
        async with sem:
            return await asyncio.to_thread(_summary_for_user_sync, db, u, live_meta)

    summaries = await asyncio.gather(*(_bounded(u) for u in users))
    rank = {"critical": 0, "warning": 1, "ok": 2}
    summaries.sort(key=lambda s: (rank.get(s.get("score", {}).get("status"), 9), -int(s.get("capacity_today", 0) or 0)))
    return {"aggregate": build_aggregate(summaries), "users": summaries}


@router.get("")
async def list_users_monitor(_: AuthUser = Depends(require_admin)):
    redis = await get_redis()
    cached = await redis.get(_CACHE_KEY)
    if cached:
        return json.loads(cached)
    result = await _build_all(live_meta=False)
    await redis.set(_CACHE_KEY, json.dumps(result), ex=_CACHE_TTL)
    return result


@router.post("/refresh-live")
async def refresh_live(_: AuthUser = Depends(require_admin)):
    result = await _build_all(live_meta=True)
    redis = await get_redis()
    await redis.set(_CACHE_KEY, json.dumps(result), ex=_CACHE_TTL)
    return result


@router.get("/{owner_id}")
async def user_detail(owner_id: str, live_meta: bool = False, _: AuthUser = Depends(require_admin)):
    db = get_db()
    return await compute_overview(db, owner_id, live_meta=live_meta)
