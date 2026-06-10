import time

import redis.asyncio as aioredis
from redis.asyncio.retry import Retry
from redis.backoff import ExponentialBackoff
from redis.exceptions import ConnectionError as RedisConnectionError, TimeoutError as RedisTimeoutError

from .config import settings

_redis = None

# Backpressure: latência acima disso = Redis degradado, recusar novos jobs
REDIS_MAX_LATENCY_MS = 500


async def get_redis():
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(
            settings.redis_url,
            decode_responses=True,
            socket_timeout=5,
            socket_connect_timeout=5,
            health_check_interval=30,
            retry=Retry(ExponentialBackoff(cap=2, base=0.1), retries=3),
            retry_on_error=[RedisConnectionError, RedisTimeoutError],
        )
    return _redis


async def assert_redis_responsive(max_latency_ms: int = REDIS_MAX_LATENCY_MS) -> None:
    """Backpressure guard: levanta RuntimeError se Redis indisponível ou latente.

    Chamar antes de aceitar jobs novos (start de bot). Não usar dentro de
    workers já em execução — eles têm retry próprio.
    """
    r = await get_redis()
    t0 = time.monotonic()
    try:
        await r.ping()
    except Exception as e:
        raise RuntimeError(f"Redis indisponível: {e}") from e
    elapsed_ms = (time.monotonic() - t0) * 1000
    if elapsed_ms > max_latency_ms:
        raise RuntimeError(
            f"Redis latente ({elapsed_ms:.0f}ms > {max_latency_ms}ms) — recusando novos jobs"
        )
