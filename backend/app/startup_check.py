"""Pre-flight check — valida dependências críticas antes de subir a API.

Uso (docker-compose command):
    python -m app.startup_check && uvicorn app.main:app ...

Sai com código 1 e log claro se Supabase, Redis ou APP_ENCRYPTION_KEY
estiverem quebrados — o container falha rápido em vez de subir zumbi.
"""
import asyncio
import logging
import sys

logging.basicConfig(level=logging.INFO, format="%(levelname)s startup_check: %(message)s")
log = logging.getLogger("startup_check")

MAX_ATTEMPTS = 10
RETRY_DELAY = 3.0


def _check_encryption_key() -> None:
    from cryptography.fernet import Fernet
    from app.config import settings

    if not settings.app_encryption_key:
        raise RuntimeError(
            "APP_ENCRYPTION_KEY ausente no .env — credenciais de bancos não funcionarão. "
            "Gere com: python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'"
        )
    try:
        Fernet(settings.app_encryption_key.encode())
    except Exception as e:
        raise RuntimeError(f"APP_ENCRYPTION_KEY inválida (não é chave Fernet base64): {e}") from e


def _check_supabase() -> None:
    from app.database import get_db

    db = get_db()
    # Query mínima numa tabela de sistema (non-tenant) — valida URL, service key
    # e conectividade. Não usar tabela tenant aqui: linter AST proíbe db.table()
    # direto em TENANT_TABLES.
    db.table("chatwoot_sync_runs").select("id").limit(1).execute()


async def _check_redis() -> None:
    from app.redis_client import get_redis

    r = await get_redis()
    try:
        pong = await r.ping()
        if not pong:
            raise RuntimeError("Redis PING não retornou PONG")
    finally:
        # fecha a conexão antes do loop encerrar — senão o GC fecha depois
        # do loop morto e suja o stderr com "Event loop is closed"
        try:
            await r.aclose()
        except Exception:
            pass
        import app.redis_client as _rc
        _rc._redis = None


async def main() -> int:
    _check_encryption_key()
    log.info("APP_ENCRYPTION_KEY OK")

    for name, fn, is_async in (
        ("Supabase", _check_supabase, False),
        ("Redis", _check_redis, True),
    ):
        for attempt in range(1, MAX_ATTEMPTS + 1):
            try:
                if is_async:
                    await fn()
                else:
                    await asyncio.to_thread(fn)
                log.info("%s OK", name)
                break
            except Exception as e:
                if attempt == MAX_ATTEMPTS:
                    log.error("%s FALHOU após %d tentativas: %s", name, MAX_ATTEMPTS, e)
                    return 1
                log.warning("%s indisponível (tentativa %d/%d): %s — retry em %.0fs",
                            name, attempt, MAX_ATTEMPTS, e, RETRY_DELAY)
                await asyncio.sleep(RETRY_DELAY)

    log.info("Todas as dependências OK — liberando startup da API")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
