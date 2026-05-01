"""Dependências de autenticação Supabase.

- `require_user`: valida o JWT do header Authorization e retorna {user_id, email, is_admin}.
- `require_admin`: idem, mas exige is_admin.
- `verify_token(token)`: utilitário usado também pelo WebSocket (que recebe via query string).
"""
from __future__ import annotations

import logging
from dataclasses import dataclass

import jwt
from fastapi import Depends, HTTPException, Request, status
from jwt import PyJWKClient

from .config import settings

logger = logging.getLogger(__name__)

_jwks_client: PyJWKClient | None = None


def _get_jwks_client() -> PyJWKClient:
    global _jwks_client
    if _jwks_client is None:
        _jwks_client = PyJWKClient(settings.supabase_jwks_url, cache_keys=True, lifespan=3600)
    return _jwks_client


@dataclass
class AuthUser:
    user_id: str
    email: str | None
    is_admin: bool
    raw: dict


def _decode_jwks(token: str) -> dict:
    client = _get_jwks_client()
    signing_key = client.get_signing_key_from_jwt(token).key
    return jwt.decode(
        token,
        signing_key,
        algorithms=["ES256", "RS256"],
        audience="authenticated",
        options={"verify_aud": True},
    )


def _decode_hs256(token: str) -> dict:
    if not settings.supabase_jwt_secret:
        raise jwt.InvalidTokenError("HS256 secret not configured")
    return jwt.decode(
        token,
        settings.supabase_jwt_secret,
        algorithms=["HS256"],
        audience="authenticated",
        options={"verify_aud": True},
    )


def verify_token(token: str) -> AuthUser:
    """Tenta JWKS (ECC/RSA) primeiro; fallback para HS256 (legacy)."""
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token ausente")

    payload: dict | None = None
    last_err: Exception | None = None
    for decoder in (_decode_jwks, _decode_hs256):
        try:
            payload = decoder(token)
            break
        except Exception as e:  # PyJWT lança várias subclasses
            last_err = e
            continue
    if payload is None:
        logger.warning("Falha ao validar JWT: %s", last_err)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token inválido")

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token sem sub")

    role = (payload.get("app_metadata") or {}).get("role")
    is_admin = role == "admin" or user_id in settings.admin_ids

    return AuthUser(
        user_id=user_id,
        email=payload.get("email"),
        is_admin=is_admin,
        raw=payload,
    )


async def require_user(request: Request) -> AuthUser:
    auth = request.headers.get("Authorization") or request.headers.get("authorization") or ""
    if not auth.lower().startswith("bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Authorization Bearer ausente")
    return verify_token(auth.split(" ", 1)[1].strip())


async def require_admin(user: AuthUser = Depends(require_user)) -> AuthUser:
    if not user.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Acesso restrito a admin")
    return user
