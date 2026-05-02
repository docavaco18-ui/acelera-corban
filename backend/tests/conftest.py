import os
import pytest
from cryptography.fernet import Fernet


@pytest.fixture(scope="session", autouse=True)
def _set_test_env():
    """Garante chave Fernet de teste antes de importar app."""
    if not os.getenv("APP_ENCRYPTION_KEY"):
        os.environ["APP_ENCRYPTION_KEY"] = Fernet.generate_key().decode()
    # Vars mínimas pra Settings não falhar
    os.environ.setdefault("V8_USERNAME", "test")
    os.environ.setdefault("V8_PASSWORD", "test")
    os.environ.setdefault("V8_AUDIENCE", "test")
    os.environ.setdefault("V8_CLIENT_ID", "test")
    os.environ.setdefault("WEBHOOK_URL", "http://localhost/webhook")
    os.environ.setdefault("SUPABASE_URL", "http://localhost")
    os.environ.setdefault("SUPABASE_ANON_KEY", "anon")
    os.environ.setdefault("SUPABASE_SERVICE_KEY", "svc")
    os.environ.setdefault("API_KEY", "test-api-key")
