"""Ponte SMS humano → bot via Redis.

Modelo escolhido: Redis LIST (BLPOP/RPUSH) + state STRING (SETEX).
Por quê esse modelo (vs pub/sub):
- BLPOP é durável: se o user POSTa o código ANTES do bot chamar request(),
  o código fica enfileirado e o bot pega assim que chama BLPOP. Pub/sub
  perderia (broadcast-only).
- TTL de 600s garante que entradas órfãs (ex: user fecha aba e nunca volta)
  sejam coletadas pelo Redis.
- Chaves escopadas por (user_id, run_id) → multi-tenant zero-risk.

State é um STRING separado pra frontend poder consultar via GET endpoint caso
o WebSocket caia entre o `sms_required` event e o submit do código (fallback
defensivo — não é o caminho feliz).
"""
from __future__ import annotations

import json
import logging
from typing import Literal

from ...redis_client import get_redis

logger = logging.getLogger(__name__)

# TTL generoso porque SMS pode levar até 5min pra chegar + tempo do user digitar
KEY_TTL_SECONDS = 600

SmsState = Literal["waiting", "submitting", "wrong", "timeout", "done", "max_attempts"]


def _code_key(user_id: str, run_id: str) -> str:
    return f"mercantil:sms:code:{user_id}:{run_id}"


def _state_key(user_id: str, run_id: str) -> str:
    return f"mercantil:sms:state:{user_id}:{run_id}"


async def set_state(user_id: str, run_id: str, status: SmsState, ttl: int = KEY_TTL_SECONDS) -> None:
    """Escreve estado consultável pelo frontend (poll fallback se WS caiu).
    TTL curto (5s) quando status='done' pra modal sumir e não reaparecer."""
    r = await get_redis()
    payload = json.dumps({"status": status})
    await r.set(_state_key(user_id, run_id), payload, ex=max(1, ttl))


async def get_state(user_id: str, run_id: str) -> dict | None:
    r = await get_redis()
    raw = await r.get(_state_key(user_id, run_id))
    if not raw:
        return None
    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        return None


async def request_sms_code(user_id: str, run_id: str, timeout: int = 300) -> str | None:
    """Bot chama essa função e BLOQUEIA até o frontend POSTar o código (ou timeout).

    Retorna o código (str de 6 dígitos) ou None se timeout estourar.

    Limpa qualquer código residual em fila antes de bloquear (defensivo
    contra reuso de chave se um run anterior terminou sujo).
    """
    r = await get_redis()
    key = _code_key(user_id, run_id)

    # Garante fila limpa antes de bloquear
    try:
        await r.delete(key)
    except Exception:
        pass

    logger.info("mercantil sms_bridge.request waiting user=%s run=%s timeout=%ds", user_id, run_id, timeout)
    # BLPOP retorna (key, value) ou None em timeout
    res = await r.blpop(key, timeout=timeout)
    if res is None:
        logger.warning("mercantil sms_bridge.request TIMEOUT user=%s run=%s", user_id, run_id)
        await set_state(user_id, run_id, "timeout", ttl=30)
        return None

    _key, code = res
    code = (code or "").strip()
    logger.info("mercantil sms_bridge.request RECEIVED user=%s run=%s len=%d", user_id, run_id, len(code))
    return code


async def submit_sms_code(user_id: str, run_id: str, code: str) -> None:
    """Frontend (via /api/mercantil/bot/sms) chama essa função.
    Empurra o código pra fila Redis. Bot que tá em BLPOP destrava."""
    r = await get_redis()
    key = _code_key(user_id, run_id)
    # RPUSH + EXPIRE; mensagens órfãs (run cancelado) são GC'd em 10min
    pipe = r.pipeline()
    pipe.rpush(key, code)
    pipe.expire(key, KEY_TTL_SECONDS)
    await pipe.execute()
    await set_state(user_id, run_id, "submitting", ttl=60)
    logger.info("mercantil sms_bridge.submit user=%s run=%s len=%d", user_id, run_id, len(code))


async def discard_code(user_id: str, run_id: str) -> None:
    """Limpa qualquer código pendente (chamar quando run aborta ou completa)."""
    r = await get_redis()
    try:
        await r.delete(_code_key(user_id, run_id))
        await r.delete(_state_key(user_id, run_id))
    except Exception:
        pass
