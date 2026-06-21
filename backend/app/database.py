import httpx
from supabase import create_client, Client
from .config import settings

_client: Client | None = None


def _harden_postgrest(client: Client) -> None:
    """Troca o httpx.Client do PostgREST por um sem HTTP/2 e sem keepalive.

    Supabase (Kong/Cloudflare) manda GOAWAY p/ reciclar conexões HTTP/2.
    httpx 0.27 levanta RemoteProtocolError('Server disconnected') ao reusar
    a conexão reciclada -> 500 no backend -> Cloudflare mostra 502 no disparo.
    HTTP/1.1 + Connection close (max_keepalive_connections=0) elimina tanto o
    GOAWAY quanto o reuse de socket morto. Mesma armadilha do PowerHub.
    """
    pg = client.postgrest
    old = pg.session
    new = httpx.Client(
        base_url=old.base_url,
        headers=old.headers,
        timeout=old.timeout,
        http2=False,
        limits=httpx.Limits(max_keepalive_connections=0, max_connections=20),
    )
    pg.session = new
    try:
        old.close()
    except Exception:
        pass


def get_db() -> Client:
    # ATENÇÃO ISOLAMENTO MULTI-TENANT: este client usa a SERVICE_KEY (service-role),
    # que é BYPASSRLS — as policies RLS (migrations 021/039/etc) NÃO são avaliadas e
    # auth.uid() é NULL. O ÚNICO isolamento real por tenant é o wrapper scoped()
    # (db_scoped.py), que injeta .eq("owner_id", user_id). NUNCA chame db.table()
    # direto numa tabela de TENANT_TABLES fora do allowlist — use scoped().
    global _client
    if _client is None:
        _client = create_client(settings.supabase_url, settings.supabase_service_key)
        try:
            _harden_postgrest(_client)
        except Exception:
            pass
    return _client


def db() -> Client:
    return get_db()
