from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    v8_username: str
    v8_password: str
    v8_audience: str
    v8_client_id: str
    v8_provider: str = "QI"
    webhook_url: str

    supabase_url: str
    supabase_anon_key: str
    supabase_service_key: str

    redis_url: str = "redis://localhost:6379"
    max_workers: int = 6
    api_key: str
    cors_origins: str = "http://localhost:3000"
    v8_proxies: str = ""

    app_encryption_key: str = ""

    # Auth Supabase (multi-tenant)
    supabase_jwt_secret: str = ""
    supabase_project_ref: str = ""
    admin_user_ids: str = ""

    max_workers_per_user: int = 10
    max_total_workers: int = 50

    # VCTex (Playwright) consome muito mais RAM (~300MB/worker), tetos menores
    vctex_max_workers_per_user: int = 2
    vctex_max_total_workers: int = 10
    vctex_portal_url: str = "https://portal.vctex.com.br/login"

    # Mercantil (Playwright + SMS humano no login). Default 1 worker — login compartilha sessão
    # via storage_state. Múltiplos workers triggar SMS múltiplas vezes; v1 fica em 1 worker.
    mercantil_max_workers_per_user: int = 1
    mercantil_max_total_workers: int = 4
    mercantil_portal_url: str = "https://meu.bancomercantil.com.br/login"
    mercantil_sms_timeout_seconds: int = 300
    mercantil_sms_max_attempts: int = 3

    anthropic_api_key: str = ""

    @property
    def proxy_list(self) -> list[str]:
        return [p.strip() for p in self.v8_proxies.split(",") if p.strip()]

    @property
    def admin_ids(self) -> set[str]:
        return {a.strip() for a in self.admin_user_ids.split(",") if a.strip()}

    @property
    def supabase_jwks_url(self) -> str:
        return f"{self.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"

    class Config:
        env_file = ".env"

settings = Settings()
