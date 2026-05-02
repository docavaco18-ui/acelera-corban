# Plano 1 — Fundação (DB + Crypto + Credenciais)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Criar a infraestrutura compartilhada (DB tables, criptografia Fernet, serviço de credenciais por usuário, endpoint REST) sobre a qual os módulos V8 e VCTex serão construídos. Fim deste plano: usuário consegue salvar e ler suas próprias credenciais criptografadas via API. Nada de UI ainda. Nada de mexer em rotas existentes do V8.

**Architecture:** Migration aditiva no Postgres (Supabase). Novo módulo `backend/app/credentials/` com: `crypto.py` (Fernet wrapper), `service.py` (CRUD com encrypt/decrypt por user+bank), `router.py` (endpoints `/api/credentials`). Tudo gated por `require_user` (Supabase JWT). Chave Fernet única no `.env` (`APP_ENCRYPTION_KEY`). Testes unitários com pytest + httpx.AsyncClient.

**Tech Stack:** Python 3.12, FastAPI, Supabase (Postgres), `cryptography` (Fernet), pytest, httpx.

---

## File Structure

**Created:**
- `migrations/002_multibank.sql` — DDL das 3 novas tabelas
- `backend/app/credentials/__init__.py`
- `backend/app/credentials/crypto.py` — Fernet wrapper (encrypt/decrypt)
- `backend/app/credentials/service.py` — `CredentialService` (get/upsert/list)
- `backend/app/credentials/router.py` — endpoints `/api/credentials/*`
- `backend/tests/__init__.py`
- `backend/tests/conftest.py` — fixtures pytest (Fernet key, supabase mock)
- `backend/tests/test_crypto.py`
- `backend/tests/test_credentials_service.py`
- `backend/tests/test_credentials_router.py`
- `backend/pytest.ini`

**Modified:**
- `backend/app/config.py` — adicionar `app_encryption_key`
- `backend/app/main.py` — registrar `credentials.router`
- `backend/requirements.txt` — adicionar `cryptography`, `pytest`, `pytest-asyncio`
- `.env.example` (criar se não existir) — documentar `APP_ENCRYPTION_KEY`
- `.gitignore` — garantir que `.env` está ignorado (verificar)

**Não modificar nesta plano:**
- Tabelas existentes `v8_leads`, `v8_bot_runs`
- Rotas existentes `leads.py`, `bot.py`, `stats.py`, `webhook.py`, `ws.py`, `admin.py`
- Frontend (nenhum arquivo)

---

## Task 1: Setup de testes (pytest + cryptography)

**Files:**
- Modify: `backend/requirements.txt`
- Create: `backend/pytest.ini`
- Create: `backend/tests/__init__.py`
- Create: `backend/tests/conftest.py`

- [ ] **Step 1.1: Adicionar deps em requirements.txt**

Editar `backend/requirements.txt`, adicionar no final:
```
cryptography==43.0.1
pytest==8.3.3
pytest-asyncio==0.24.0
```

- [ ] **Step 1.2: Instalar deps**

Run:
```bash
cd "/Users/macbookdegabriel/projetos/ACELERA CORBAN/backend" && pip install -r requirements.txt
```

Expected: `Successfully installed cryptography-43.0.1 pytest-8.3.3 pytest-asyncio-0.24.0`

- [ ] **Step 1.3: Criar pytest.ini**

`backend/pytest.ini`:
```ini
[pytest]
asyncio_mode = auto
testpaths = tests
python_files = test_*.py
python_classes = Test*
python_functions = test_*
```

- [ ] **Step 1.4: Criar tests/__init__.py vazio**

`backend/tests/__init__.py`: vazio.

- [ ] **Step 1.5: Criar conftest.py com fixture de chave Fernet**

`backend/tests/conftest.py`:
```python
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
```

- [ ] **Step 1.6: Verificar pytest descobre o setup**

Run:
```bash
cd "/Users/macbookdegabriel/projetos/ACELERA CORBAN/backend" && pytest --collect-only -q
```

Expected: `0 tests collected` (sem erro de import).

- [ ] **Step 1.7: Commit**

```bash
cd "/Users/macbookdegabriel/projetos/ACELERA CORBAN" && git add backend/requirements.txt backend/pytest.ini backend/tests/ && git commit -m "chore: setup pytest + cryptography

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Migration DB (002_multibank.sql)

**Files:**
- Create: `migrations/002_multibank.sql`

- [ ] **Step 2.1: Escrever migration**

`migrations/002_multibank.sql`:
```sql
-- 002_multibank.sql
-- Adiciona infra multi-banco: credenciais por usuário + tabelas VCTex.
-- ADITIVO. Não toca em v8_leads / v8_bot_runs.

-- ============================================================
-- 1. Credenciais por usuário (Fernet-encrypted)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.user_bank_credentials (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL,
    bank_code TEXT NOT NULL CHECK (bank_code IN ('v8','vctex')),
    login_enc BYTEA,
    password_enc BYTEA,
    extra_enc BYTEA,
    proxies_enc BYTEA,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (user_id, bank_code)
);

CREATE INDEX IF NOT EXISTS idx_user_bank_creds_user
    ON public.user_bank_credentials (user_id);

CREATE OR REPLACE FUNCTION public.user_bank_creds_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS user_bank_creds_updated_at_trg ON public.user_bank_credentials;
CREATE TRIGGER user_bank_creds_updated_at_trg
    BEFORE UPDATE ON public.user_bank_credentials
    FOR EACH ROW EXECUTE FUNCTION public.user_bank_creds_updated_at();

-- RLS: bloquear acesso direto via PostgREST. Apenas service_role lê.
ALTER TABLE public.user_bank_credentials ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_all ON public.user_bank_credentials;
CREATE POLICY deny_all ON public.user_bank_credentials FOR ALL USING (false);

-- ============================================================
-- 2. VCTex leads
-- ============================================================
CREATE TABLE IF NOT EXISTS public.vctex_leads (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    owner_id UUID,
    cpf VARCHAR(14) NOT NULL,
    telefone VARCHAR(20),
    nome VARCHAR(255),
    status VARCHAR(30) DEFAULT 'pendente'
        CHECK (status IN ('pendente','fase0','fase1','fase2','elegivel','inelegivel','erro')),
    valor_liberado NUMERIC(12,2),
    payload JSONB,
    erro TEXT,
    tentativas INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (owner_id, cpf)
);

CREATE INDEX IF NOT EXISTS idx_vctex_leads_owner_status
    ON public.vctex_leads (owner_id, status);

DROP TRIGGER IF EXISTS vctex_leads_updated_at ON public.vctex_leads;
CREATE TRIGGER vctex_leads_updated_at
    BEFORE UPDATE ON public.vctex_leads
    FOR EACH ROW EXECUTE FUNCTION public.v8_update_updated_at();

-- ============================================================
-- 3. VCTex bot runs
-- ============================================================
CREATE TABLE IF NOT EXISTS public.vctex_bot_runs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    owner_id UUID,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    status VARCHAR(20) DEFAULT 'running',
    num_workers INTEGER,
    total_processed INTEGER DEFAULT 0,
    total_elegiveis INTEGER DEFAULT 0,
    total_inelegiveis INTEGER DEFAULT 0,
    erro TEXT
);

CREATE INDEX IF NOT EXISTS idx_vctex_bot_runs_owner
    ON public.vctex_bot_runs (owner_id, started_at DESC);
```

- [ ] **Step 2.2: Aplicar migration no Supabase**

Manual: copiar conteúdo de `migrations/002_multibank.sql`, abrir https://supabase.com/dashboard/project/gfyharrnkcncpngbvhpj/sql/new, colar, clicar **Run**.

Expected: `Success. No rows returned`.

- [ ] **Step 2.3: Validar tabelas criadas**

No SQL Editor do Supabase, rodar:
```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('user_bank_credentials','vctex_leads','vctex_bot_runs')
ORDER BY table_name;
```

Expected: 3 linhas (`user_bank_credentials`, `vctex_bot_runs`, `vctex_leads`).

- [ ] **Step 2.4: Commit**

```bash
cd "/Users/macbookdegabriel/projetos/ACELERA CORBAN" && git add migrations/002_multibank.sql && git commit -m "feat(db): migration multi-banco (credentials, vctex_leads, vctex_bot_runs)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Crypto module (Fernet wrapper)

**Files:**
- Create: `backend/tests/test_crypto.py`
- Create: `backend/app/credentials/__init__.py`
- Create: `backend/app/credentials/crypto.py`
- Modify: `backend/app/config.py`

- [ ] **Step 3.1: Adicionar `app_encryption_key` em config.py**

Editar `backend/app/config.py`, adicionar campo após `cors_origins`:

```python
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
```

- [ ] **Step 3.2: Escrever testes**

`backend/tests/test_crypto.py`:
```python
from app.credentials.crypto import encrypt, decrypt


def test_encrypt_decrypt_roundtrip():
    plain = "minha-senha-secreta"
    cipher = encrypt(plain)
    assert isinstance(cipher, bytes)
    assert cipher != plain.encode()
    assert decrypt(cipher) == plain


def test_encrypt_handles_unicode():
    plain = "senh@çãõéü"
    assert decrypt(encrypt(plain)) == plain


def test_encrypt_none_returns_none():
    assert encrypt(None) is None


def test_decrypt_none_returns_none():
    assert decrypt(None) is None


def test_encrypt_empty_string():
    cipher = encrypt("")
    assert cipher is not None
    assert decrypt(cipher) == ""
```

- [ ] **Step 3.3: Rodar testes — devem falhar**

Run:
```bash
cd "/Users/macbookdegabriel/projetos/ACELERA CORBAN/backend" && pytest tests/test_crypto.py -v
```

Expected: `ModuleNotFoundError: No module named 'app.credentials'`.

- [ ] **Step 3.4: Criar __init__.py**

`backend/app/credentials/__init__.py`: vazio.

- [ ] **Step 3.5: Implementar crypto.py**

`backend/app/credentials/crypto.py`:
```python
from cryptography.fernet import Fernet
from ..config import settings

_fernet: Fernet | None = None


def _get_fernet() -> Fernet:
    global _fernet
    if _fernet is None:
        key = settings.app_encryption_key
        if not key:
            raise RuntimeError(
                "APP_ENCRYPTION_KEY não configurado. "
                "Gere com: python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())'"
            )
        _fernet = Fernet(key.encode() if isinstance(key, str) else key)
    return _fernet


def encrypt(plaintext: str | None) -> bytes | None:
    if plaintext is None:
        return None
    return _get_fernet().encrypt(plaintext.encode("utf-8"))


def decrypt(ciphertext: bytes | None) -> str | None:
    if ciphertext is None:
        return None
    return _get_fernet().decrypt(ciphertext).decode("utf-8")
```

- [ ] **Step 3.6: Rodar testes — devem passar**

Run:
```bash
cd "/Users/macbookdegabriel/projetos/ACELERA CORBAN/backend" && pytest tests/test_crypto.py -v
```

Expected: `5 passed`.

- [ ] **Step 3.7: Commit**

```bash
cd "/Users/macbookdegabriel/projetos/ACELERA CORBAN" && git add backend/app/credentials/ backend/app/config.py backend/tests/test_crypto.py && git commit -m "feat(crypto): Fernet wrapper para credenciais

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: CredentialService (get / upsert / list)

**Files:**
- Create: `backend/tests/test_credentials_service.py`
- Create: `backend/app/credentials/service.py`

- [ ] **Step 4.1: Escrever testes**

`backend/tests/test_credentials_service.py`:
```python
import pytest
from unittest.mock import MagicMock
from uuid import uuid4

from app.credentials.service import CredentialService, BankCredentials


@pytest.fixture
def fake_db():
    """Mock do client Supabase com .table().select()/insert()/update()."""
    db = MagicMock()
    db._rows = {}  # (user_id, bank_code) -> row dict

    def _table(name):
        assert name == "user_bank_credentials"
        return _Q(db)
    db.table = _table
    return db


class _Q:
    """Query builder fake bem simples."""
    def __init__(self, db):
        self.db = db
        self._filters = {}
        self._action = None
        self._payload = None

    def select(self, _cols):
        self._action = "select"
        return self

    def insert(self, payload):
        self._action = "insert"
        self._payload = payload
        return self

    def update(self, payload):
        self._action = "update"
        self._payload = payload
        return self

    def upsert(self, payload, on_conflict=None):
        self._action = "upsert"
        self._payload = payload
        self._on_conflict = on_conflict
        return self

    def eq(self, col, val):
        self._filters[col] = val
        return self

    def execute(self):
        if self._action == "select":
            key = (self._filters.get("user_id"), self._filters.get("bank_code"))
            row = self.db._rows.get(key)
            return MagicMock(data=[row] if row else [])
        if self._action in ("insert", "upsert"):
            payload = self._payload
            key = (payload["user_id"], payload["bank_code"])
            self.db._rows[key] = payload
            return MagicMock(data=[payload])
        raise NotImplementedError(self._action)


def test_upsert_then_get_roundtrip(fake_db):
    user_id = str(uuid4())
    svc = CredentialService(fake_db)
    svc.upsert(user_id, "v8", login="alice", password="s3cret", proxies=["http://p1", "http://p2"])

    creds = svc.get(user_id, "v8")
    assert creds is not None
    assert creds.login == "alice"
    assert creds.password == "s3cret"
    assert creds.proxies == ["http://p1", "http://p2"]


def test_get_nonexistent_returns_none(fake_db):
    svc = CredentialService(fake_db)
    assert svc.get(str(uuid4()), "v8") is None


def test_upsert_proxies_optional(fake_db):
    user_id = str(uuid4())
    svc = CredentialService(fake_db)
    svc.upsert(user_id, "vctex", login="bob", password="pw")
    creds = svc.get(user_id, "vctex")
    assert creds.login == "bob"
    assert creds.proxies == []


def test_upsert_overwrites_previous(fake_db):
    user_id = str(uuid4())
    svc = CredentialService(fake_db)
    svc.upsert(user_id, "v8", login="alice", password="old")
    svc.upsert(user_id, "v8", login="alice", password="new")
    creds = svc.get(user_id, "v8")
    assert creds.password == "new"


def test_get_handles_missing_proxies_field(fake_db):
    """Robustez: linha legada sem proxies_enc não deve quebrar."""
    user_id = str(uuid4())
    svc = CredentialService(fake_db)
    svc.upsert(user_id, "v8", login="x", password="y")
    # simula campo NULL no banco
    fake_db._rows[(user_id, "v8")]["proxies_enc"] = None
    creds = svc.get(user_id, "v8")
    assert creds.proxies == []
```

- [ ] **Step 4.2: Rodar testes — devem falhar**

Run:
```bash
cd "/Users/macbookdegabriel/projetos/ACELERA CORBAN/backend" && pytest tests/test_credentials_service.py -v
```

Expected: `ModuleNotFoundError: No module named 'app.credentials.service'`.

- [ ] **Step 4.3: Implementar service.py**

`backend/app/credentials/service.py`:
```python
import json
from dataclasses import dataclass, field
from typing import Any
from .crypto import encrypt, decrypt


@dataclass
class BankCredentials:
    user_id: str
    bank_code: str
    login: str | None = None
    password: str | None = None
    extra: dict = field(default_factory=dict)
    proxies: list[str] = field(default_factory=list)


class CredentialService:
    """CRUD de credenciais por (user_id, bank_code), com Fernet encrypt/decrypt."""

    TABLE = "user_bank_credentials"

    def __init__(self, db: Any):
        self.db = db

    def get(self, user_id: str, bank_code: str) -> BankCredentials | None:
        resp = (
            self.db.table(self.TABLE)
            .select("*")
            .eq("user_id", user_id)
            .eq("bank_code", bank_code)
            .execute()
        )
        rows = resp.data or []
        if not rows:
            return None
        row = rows[0]
        return BankCredentials(
            user_id=user_id,
            bank_code=bank_code,
            login=decrypt(row.get("login_enc")),
            password=decrypt(row.get("password_enc")),
            extra=json.loads(decrypt(row.get("extra_enc")) or "{}") if row.get("extra_enc") else {},
            proxies=json.loads(decrypt(row.get("proxies_enc")) or "[]") if row.get("proxies_enc") else [],
        )

    def upsert(
        self,
        user_id: str,
        bank_code: str,
        login: str | None = None,
        password: str | None = None,
        extra: dict | None = None,
        proxies: list[str] | None = None,
    ) -> None:
        payload = {
            "user_id": user_id,
            "bank_code": bank_code,
            "login_enc": encrypt(login),
            "password_enc": encrypt(password),
            "extra_enc": encrypt(json.dumps(extra)) if extra else None,
            "proxies_enc": encrypt(json.dumps(proxies)) if proxies else None,
        }
        self.db.table(self.TABLE).upsert(
            payload, on_conflict="user_id,bank_code"
        ).execute()
```

- [ ] **Step 4.4: Rodar testes — devem passar**

Run:
```bash
cd "/Users/macbookdegabriel/projetos/ACELERA CORBAN/backend" && pytest tests/test_credentials_service.py -v
```

Expected: `5 passed`.

Nota: O fake_db é simplificado e não implementa ON CONFLICT real. O método `upsert` no fake apenas sobrescreve a key (user_id, bank_code) no dict, o que é suficiente pra simular o comportamento esperado.

- [ ] **Step 4.5: Commit**

```bash
cd "/Users/macbookdegabriel/projetos/ACELERA CORBAN" && git add backend/app/credentials/service.py backend/tests/test_credentials_service.py && git commit -m "feat(credentials): CredentialService get/upsert com Fernet

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Router /api/credentials (GET, PUT)

**Files:**
- Create: `backend/tests/test_credentials_router.py`
- Create: `backend/app/credentials/router.py`
- Modify: `backend/app/main.py`

Decisão de API:
- `GET /api/credentials` → retorna `{"v8": {"configured": true, "login": "alice", "has_password": true, "proxies_count": 2}, "vctex": null}` (sem expor senha em texto, sem expor URLs de proxy).
- `PUT /api/credentials/{bank_code}` → body `{"login": "...", "password": "...", "proxies": ["http://..."]}` → grava encriptado.

- [ ] **Step 5.1: Verificar como o `require_user` é importado hoje**

Run:
```bash
cd "/Users/macbookdegabriel/projetos/ACELERA CORBAN/backend" && grep -rn "require_user\|current_user\|get_user" app/routers/admin.py app/routers/leads.py app/routers/bot.py 2>/dev/null | head -20
```

Expected: ver onde `require_user` mora (provavelmente `app/auth.py` ou `app/services/auth_service.py`). Anotar o import path.

> **Importante:** se o nome diferente daqui (ex: `get_current_user`), substituir nos snippets abaixo.

- [ ] **Step 5.2: Escrever testes do router**

`backend/tests/test_credentials_router.py`:
```python
import pytest
from fastapi.testclient import TestClient
from unittest.mock import patch, MagicMock

from app.main import app
from app.credentials.service import CredentialService, BankCredentials


@pytest.fixture
def fake_user():
    return {"sub": "11111111-1111-1111-1111-111111111111", "email": "u@test"}


@pytest.fixture
def client(fake_user):
    """TestClient com auth/db mockados."""
    # Sobrescreve a dep de auth pra retornar user fake
    from app.credentials.router import require_user, get_credential_service
    fake_svc = MagicMock(spec=CredentialService)
    app.dependency_overrides[require_user] = lambda: fake_user
    app.dependency_overrides[get_credential_service] = lambda: fake_svc
    with TestClient(app) as c:
        c.fake_svc = fake_svc
        yield c
    app.dependency_overrides.clear()


def test_get_returns_empty_when_no_creds(client):
    client.fake_svc.get.return_value = None
    resp = client.get("/api/credentials")
    assert resp.status_code == 200
    body = resp.json()
    assert body == {"v8": None, "vctex": None}


def test_get_returns_safe_summary(client, fake_user):
    client.fake_svc.get.side_effect = lambda uid, bank: (
        BankCredentials(user_id=uid, bank_code=bank, login="alice", password="s3cret",
                        proxies=["http://p1", "http://p2"])
        if bank == "v8" else None
    )
    resp = client.get("/api/credentials")
    assert resp.status_code == 200
    body = resp.json()
    assert body["v8"] == {"configured": True, "login": "alice", "has_password": True, "proxies_count": 2}
    assert body["vctex"] is None
    # NUNCA expor senha
    assert "s3cret" not in resp.text
    assert "p1" not in resp.text


def test_put_creates_credentials(client):
    payload = {"login": "alice", "password": "s3cret", "proxies": ["http://p1"]}
    resp = client.put("/api/credentials/v8", json=payload)
    assert resp.status_code == 204
    client.fake_svc.upsert.assert_called_once()
    args, kwargs = client.fake_svc.upsert.call_args
    assert kwargs["bank_code"] == "v8"
    assert kwargs["login"] == "alice"
    assert kwargs["password"] == "s3cret"
    assert kwargs["proxies"] == ["http://p1"]


def test_put_rejects_invalid_bank(client):
    resp = client.put("/api/credentials/banco_x", json={"login": "a", "password": "b"})
    assert resp.status_code == 422 or resp.status_code == 400


def test_put_proxies_optional(client):
    resp = client.put("/api/credentials/vctex", json={"login": "bob", "password": "pw"})
    assert resp.status_code == 204
    args, kwargs = client.fake_svc.upsert.call_args
    assert kwargs["proxies"] == []
```

- [ ] **Step 5.3: Rodar testes — devem falhar**

Run:
```bash
cd "/Users/macbookdegabriel/projetos/ACELERA CORBAN/backend" && pytest tests/test_credentials_router.py -v
```

Expected: `ImportError: cannot import name 'require_user' from 'app.credentials.router'` (ainda não existe).

- [ ] **Step 5.4: Implementar router.py**

`backend/app/credentials/router.py`:
```python
from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from ..database import get_db
from .service import CredentialService

# Auth dep: importar do mesmo lugar que os routers V8 usam.
# Ajustar import abaixo conforme Step 5.1.
from ..services.auth_service import require_user  # NOTE: confirmar nome real em Step 5.1


BankCode = Literal["v8", "vctex"]
ALLOWED_BANKS: tuple[BankCode, ...] = ("v8", "vctex")

router = APIRouter(prefix="/api/credentials", tags=["credentials"])


def get_credential_service() -> CredentialService:
    return CredentialService(get_db())


class CredentialPayload(BaseModel):
    login: str = Field(..., min_length=1)
    password: str = Field(..., min_length=1)
    proxies: list[str] = Field(default_factory=list)


class BankSummary(BaseModel):
    configured: bool
    login: str | None
    has_password: bool
    proxies_count: int


@router.get("")
def list_credentials(
    user=Depends(require_user),
    svc: CredentialService = Depends(get_credential_service),
) -> dict[str, BankSummary | None]:
    user_id = user["sub"]
    out: dict[str, BankSummary | None] = {}
    for bank in ALLOWED_BANKS:
        creds = svc.get(user_id, bank)
        if creds is None:
            out[bank] = None
        else:
            out[bank] = BankSummary(
                configured=True,
                login=creds.login,
                has_password=bool(creds.password),
                proxies_count=len(creds.proxies),
            )
    return out


@router.put("/{bank_code}", status_code=status.HTTP_204_NO_CONTENT)
def upsert_credentials(
    bank_code: str,
    payload: CredentialPayload,
    user=Depends(require_user),
    svc: CredentialService = Depends(get_credential_service),
):
    if bank_code not in ALLOWED_BANKS:
        raise HTTPException(
            status_code=400,
            detail=f"bank_code inválido. Aceitos: {ALLOWED_BANKS}",
        )
    svc.upsert(
        user_id=user["sub"],
        bank_code=bank_code,
        login=payload.login,
        password=payload.password,
        proxies=payload.proxies,
    )
```

> **Se Step 5.1 mostrou que o nome do dep não é `require_user`**, ajustar o import. Se for sync vs async, ajustar `def` vs `async def` nos handlers conforme padrão dos outros routers.

- [ ] **Step 5.5: Registrar router em main.py**

Editar `backend/app/main.py`:

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .config import settings
from .routers import leads, bot, stats, webhook, ws, admin
from .credentials.router import router as credentials_router

app = FastAPI(title="V8 CLT Higienização", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins.split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(leads.router)
app.include_router(bot.router)
app.include_router(stats.router)
app.include_router(webhook.router)
app.include_router(ws.router)
app.include_router(admin.router)
app.include_router(credentials_router)

@app.get("/health")
async def health():
    return {"status": "ok"}
```

- [ ] **Step 5.6: Rodar testes — devem passar**

Run:
```bash
cd "/Users/macbookdegabriel/projetos/ACELERA CORBAN/backend" && pytest tests/ -v
```

Expected: todos os testes (crypto + service + router) passando.

- [ ] **Step 5.7: Smoke local — subir backend e testar endpoint**

Run em um terminal:
```bash
cd "/Users/macbookdegabriel/projetos/ACELERA CORBAN/backend" && \
  APP_ENCRYPTION_KEY="$(python -c 'from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())')" \
  uvicorn app.main:app --port 8002 --reload
```

Em outro terminal:
```bash
curl -s http://localhost:8002/openapi.json | python -c "import sys,json; spec=json.load(sys.stdin); paths=[p for p in spec['paths'] if 'credentials' in p]; print(paths)"
```

Expected: `['/api/credentials', '/api/credentials/{bank_code}']`.

Mata o uvicorn (Ctrl+C).

- [ ] **Step 5.8: Commit**

```bash
cd "/Users/macbookdegabriel/projetos/ACELERA CORBAN" && git add backend/app/credentials/router.py backend/app/main.py backend/tests/test_credentials_router.py && git commit -m "feat(credentials): endpoints GET/PUT /api/credentials

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Geração de chave + .env.example

**Files:**
- Create: `.env.example`
- Modify: `.env` (local, fora do git)
- Modify: `.gitignore` (verificar)

- [ ] **Step 6.1: Verificar .gitignore**

Run:
```bash
cd "/Users/macbookdegabriel/projetos/ACELERA CORBAN" && grep -E "^\.env$|^\.env\b" .gitignore
```

Expected: linha com `.env` presente. Se não estiver, adicionar `.env` ao `.gitignore` antes de continuar.

- [ ] **Step 6.2: Gerar chave Fernet**

Run:
```bash
python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Expected: string base64 de 44 chars terminando em `=`. Copiar.

- [ ] **Step 6.3: Adicionar ao .env local**

Editar `.env` (gitignored), adicionar linha:
```
APP_ENCRYPTION_KEY=<chave-gerada-no-step-6.2>
```

- [ ] **Step 6.4: Criar .env.example**

`.env.example` (na raiz do projeto):
```
# Supabase
SUPABASE_URL=https://gfyharrnkcncpngbvhpj.supabase.co
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_KEY=
SUPABASE_JWT_SECRET=
SUPABASE_PROJECT_REF=gfyharrnkcncpngbvhpj

# V8 (será movido pra credenciais por usuário em planos futuros)
V8_USERNAME=
V8_PASSWORD=
V8_AUDIENCE=
V8_CLIENT_ID=
V8_PROVIDER=QI
V8_PROXIES=

# Webhook
WEBHOOK_URL=

# Redis
REDIS_URL=redis://redis:6379

# API key (legacy)
API_KEY=

# CORS
CORS_ORIGINS=http://localhost:3002,https://aceleracorban.com.br

# Admin
ADMIN_USER_IDS=

# Multi-banco — chave Fernet (gerar com: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())")
# CRÍTICO: fazer backup. Perda da chave = perda de todas credenciais cadastradas.
APP_ENCRYPTION_KEY=
```

- [ ] **Step 6.5: Adicionar chave em produção (VPS)**

Manual via Web Terminal Hostinger:
```bash
cd /root/acelera-corban
# pegar chave do mesmo Step 6.2 ou gerar nova específica de prod (recomendado: nova)
NEW_KEY=$(python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())")
echo "APP_ENCRYPTION_KEY=$NEW_KEY" >> .env
echo "Chave de prod (BACKUP IMEDIATAMENTE): $NEW_KEY"
```

> **CRÍTICO:** copiar a chave gerada e guardar em local seguro fora da VPS (cofre, 1Password, etc). Documentar em `PROGRESS.md` que a chave existe (NÃO o valor).

- [ ] **Step 6.6: Atualizar PROGRESS.md**

Editar `PROGRESS.md` (gitignored), adicionar seção:
```
## Chave de criptografia (Fernet) — APP_ENCRYPTION_KEY
- Gerada em 2026-05-02 para credenciais por usuário em multi-banco
- Local: VPS `/root/acelera-corban/.env`
- Backup: <onde foi salvo o backup, ex: 1Password vault "ACELERA CORBAN">
- Perder esta chave = perder todas as credenciais de banco dos usuários (impossível recuperar)
```

- [ ] **Step 6.7: Commit (só .env.example)**

```bash
cd "/Users/macbookdegabriel/projetos/ACELERA CORBAN" && git add .env.example && git commit -m "docs: .env.example com APP_ENCRYPTION_KEY documentado

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Validação end-to-end

- [ ] **Step 7.1: Rodar suite completa**

```bash
cd "/Users/macbookdegabriel/projetos/ACELERA CORBAN/backend" && pytest tests/ -v
```

Expected: todos passando, sem erros.

- [ ] **Step 7.2: Smoke local com Docker compose**

```bash
cd "/Users/macbookdegabriel/projetos/ACELERA CORBAN" && docker compose up -d --build && sleep 5 && curl -s http://localhost:8002/health
```

Expected: `{"status":"ok"}`.

- [ ] **Step 7.3: Smoke endpoint credentials sem auth (deve dar 401/403)**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8002/api/credentials
```

Expected: `401` ou `403` (depende da implementação atual de `require_user`).

- [ ] **Step 7.4: Subir alteração pra produção**

```bash
cd "/Users/macbookdegabriel/projetos/ACELERA CORBAN" && git push origin main
```

Em outro terminal (Web Terminal Hostinger):
```bash
cd /root/acelera-corban && git pull && docker compose -f docker-compose.prod.yml --env-file .env up -d --build
```

> **Pré-requisito:** Step 6.5 já adicionou `APP_ENCRYPTION_KEY` no `.env` da VPS. Sem isso, o backend vai subir mas qualquer chamada em `/api/credentials` quebra ao usar Fernet.

- [ ] **Step 7.5: Smoke produção**

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://aceleracorban.com.br/api/credentials
```

Expected: `401` ou `403` (auth obrigatória — o que prova que o endpoint subiu).

```bash
curl -s https://aceleracorban.com.br/health
```

Expected: `{"status":"ok"}`.

- [ ] **Step 7.6: Tag de fim de fase**

```bash
cd "/Users/macbookdegabriel/projetos/ACELERA CORBAN" && git tag plan1-foundation-complete -m "Plano 1 (Fundação multi-banco) concluído" && git push origin plan1-foundation-complete
```

---

## Critérios de aceite

- [ ] Migration `002_multibank.sql` aplicada no Supabase. 3 tabelas novas existem.
- [ ] `pytest tests/` 100% passando.
- [ ] `GET /api/credentials` em produção responde 401/403 sem auth (endpoint registrado).
- [ ] Chave Fernet em produção está em backup seguro fora da VPS.
- [ ] V8 atual continua funcionando exatamente como antes (nenhuma rota velha foi tocada).

## Riscos e mitigações

- **Esqueci de configurar `APP_ENCRYPTION_KEY` em prod** → backend vai subir, mas qualquer chamada que use Fernet vai 500. Mitigação: Step 6.5 explícito antes do deploy.
- **`require_user` tem nome/local diferente** → Step 5.1 valida primeiro. Ajustar antes de codar.
- **Migration falha por já ter tabela** → DDL usa `IF NOT EXISTS`, idempotente.
- **Trigger `v8_update_updated_at` não existe** → migration `001` já criou ela; `002` reutiliza. Validar visualmente em Step 2.3 que migration rodou sem erro.

## Próximo plano

Após ✅ deste plano, partir pro **Plano 2 — V8 Module**: mover código V8 atual pra `backend/app/banks/v8/`, fazer bot ler credenciais via `CredentialService`, instalar compat shim em `main.py` mantendo rotas antigas funcionando.
