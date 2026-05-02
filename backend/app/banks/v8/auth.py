import asyncio
import time
import httpx

from ...config import settings

_token_cache: dict[str, tuple[str, float]] = {}  # user_id → (token, expires_at_epoch)
_locks: dict[str, asyncio.Lock] = {}
_locks_meta_lock = asyncio.Lock()
_REFRESH_LEEWAY_SECONDS = 30


async def _lock_for(user_id: str) -> asyncio.Lock:
    async with _locks_meta_lock:
        lock = _locks.get(user_id)
        if lock is None:
            lock = asyncio.Lock()
            _locks[user_id] = lock
        return lock


def _cached(user_id: str) -> str | None:
    entry = _token_cache.get(user_id)
    if not entry:
        return None
    token, expires_at = entry
    if expires_at > time.time() + _REFRESH_LEEWAY_SECONDS:
        return token
    return None


async def get_token(user_id: str, login: str, password: str) -> str:
    cached = _cached(user_id)
    if cached:
        return cached
    lock = await _lock_for(user_id)
    async with lock:
        cached = _cached(user_id)
        if cached:
            return cached
        token, expires_at = await _fetch_token(login, password)
        _token_cache[user_id] = (token, expires_at)
        return token


def invalidate(user_id: str) -> None:
    """Limpa cache do user. Chamada em 401/429 da V8."""
    _token_cache.pop(user_id, None)


async def _fetch_token(login: str, password: str) -> tuple[str, float]:
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            "https://auth.v8sistema.com/oauth/token",
            data={
                "grant_type": "password",
                "username": login,
                "password": password,
                "audience": settings.v8_audience,
                "scope": "offline_access",
                "client_id": settings.v8_client_id,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
    return data["access_token"], time.time() + data["expires_in"] - 300
