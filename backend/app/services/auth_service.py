import asyncio
import time
import httpx
from ..config import settings

_token: str | None = None
_expires_at: float = 0
_lock = asyncio.Lock()

async def get_token() -> str:
    global _token, _expires_at
    if _token and time.time() < _expires_at:
        return _token

    async with _lock:
        if _token and time.time() < _expires_at:
            return _token

        async with httpx.AsyncClient() as client:
            resp = await client.post(
                "https://auth.v8sistema.com/oauth/token",
                data={
                    "grant_type": "password",
                    "username": settings.v8_username,
                    "password": settings.v8_password,
                    "audience": settings.v8_audience,
                    "scope": "offline_access",
                    "client_id": settings.v8_client_id,
                },
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                timeout=30,
            )
            resp.raise_for_status()
            data = resp.json()

        _token = data["access_token"]
        _expires_at = time.time() + data["expires_in"] - 300
        return _token
