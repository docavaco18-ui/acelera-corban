# V8 Multi-Tenant Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tornar o módulo V8 multi-tenant: cada cliente cadastra suas credenciais V8, processa seus próprios leads em pool isolado, sem fallback pro `.env`. Isolamento DB-level + Python-level + AST lint.

**Architecture:** `backend/app/banks/v8/` consolida lógica V8 (auth com lock por user, worker com creds injetadas, bot pool por user com tetos globais). `backend/app/db_scoped.py` força `owner_id` em toda query de tabela tenant. Migration `003_multitenant_v8.sql` adiciona `NOT NULL`, `UNIQUE(consult_id)` parcial, RLS, e backfill admin. Shims em `services/auth_service.py` e `services/worker.py` durante transição (removidos no Plano 5).

**Tech Stack:** FastAPI, Python 3.12, Supabase (Postgres + Auth), httpx, pytest + pytest-asyncio, cryptography (Fernet — Plano 1), supabase-py.

**Spec source:** `docs/superpowers/specs/2026-05-02-v8-multitenant-design.md`

---

## File Map

### Criar
- `migrations/003_multitenant_v8.sql` — completar 002 (NOT NULL, UNIQUE consult_id, RLS, backfill explícito)
- `backend/app/db_scoped.py` — `scoped()` + `_ScopedQuery` superfície completa
- `backend/app/banks/__init__.py`
- `backend/app/banks/v8/__init__.py`
- `backend/app/banks/v8/credentials_helper.py` — `get_v8_runtime_creds(user_id, db)`
- `backend/app/banks/v8/auth.py` — token cache com lock por user
- `backend/app/banks/v8/worker.py` — `LeadWorker(user_id, creds, db, on_event, role, role_index)`
- `backend/app/banks/v8/bot_pool.py` — `V8BotPool` com tetos
- `backend/tests/test_db_scoped.py`
- `backend/tests/test_no_unscoped_tenant_access.py` — lint AST
- `backend/tests/test_v8_credentials_helper.py`
- `backend/tests/test_v8_auth_token_cache.py`
- `backend/tests/test_v8_bot_pool.py`
- `backend/tests/test_isolation_e2e.py` — testes de isolamento entre tenants

### Modificar
- `backend/app/config.py` — `max_workers_per_user`, `max_total_workers`
- `backend/app/main.py` — singleton `app.state.v8_pool`
- `backend/app/services/auth_service.py` — vira shim; mantém `get_token()` antigo deprecated
- `backend/app/services/worker.py` — vira shim; reexporta `LeadWorker`
- `backend/app/services/v8_api_service.py` — todas funções recebem `token` e `proxy`
- `backend/app/services/bot_service.py` — delega pra `V8BotPool`
- `backend/app/routers/leads.py` — extrai `user_id`, usa `scoped()`, valida creds em `consult`
- `backend/app/routers/bot.py` — usa `app.state.v8_pool`, valida creds antes de start
- `backend/app/routers/stats.py` — `scoped()`
- `backend/app/routers/webhook.py` — resolve `owner_id` por `consult_id`, update por `id`
- `backend/app/routers/ws.py` — canal por `user_id`

---

## Task 1: Migration SQL 003

**Files:**
- Create: `migrations/003_multitenant_v8.sql`

- [ ] **Step 1: Criar a migration**

```sql
-- migrations/003_multitenant_v8.sql
-- Completa 002_multi_tenant.sql: NOT NULL, UNIQUE consult_id, RLS, backfill admin.
-- Aplicar APÓS 002. Runbook na spec (parar container, backup, etc.).

-- 1. Backfill: substitua <ADMIN_USER_ID> antes de rodar
-- UPDATE public.v8_leads    SET owner_id = '<ADMIN_USER_ID>' WHERE owner_id IS NULL;
-- UPDATE public.v8_bot_runs SET owner_id = '<ADMIN_USER_ID>' WHERE owner_id IS NULL;

-- 2. NOT NULL após backfill
ALTER TABLE public.v8_leads    ALTER COLUMN owner_id SET NOT NULL;
ALTER TABLE public.v8_bot_runs ALTER COLUMN owner_id SET NOT NULL;

-- 3. UNIQUE em consult_id (parcial — ignora NULLs de leads ainda não consultados)
DROP INDEX IF EXISTS public.v8_leads_consult_id_unique;
CREATE UNIQUE INDEX v8_leads_consult_id_unique
    ON public.v8_leads(consult_id)
    WHERE consult_id IS NOT NULL;

-- 4. RLS (defesa secundária — service_role bypassa, mas previne acesso direto via JWT)
ALTER TABLE public.v8_leads    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.v8_bot_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS v8_leads_owner    ON public.v8_leads;
DROP POLICY IF EXISTS v8_bot_runs_owner ON public.v8_bot_runs;
CREATE POLICY v8_leads_owner    ON public.v8_leads    USING (owner_id = auth.uid());
CREATE POLICY v8_bot_runs_owner ON public.v8_bot_runs USING (owner_id = auth.uid());
```

- [ ] **Step 2: Commit**

```bash
git add migrations/003_multitenant_v8.sql
git commit -m "feat(migration): 003 multi-tenant v8 — NOT NULL, UNIQUE consult_id, RLS"
```

---

## Task 2: Settings — tetos de pool

**Files:**
- Modify: `backend/app/config.py`

- [ ] **Step 1: Adicionar settings**

Adicionar dentro da classe `Settings` (depois de `admin_ids`):

```python
    max_workers_per_user: int = 10
    max_total_workers: int = 50
```

- [ ] **Step 2: Commit**

```bash
git add backend/app/config.py
git commit -m "feat(config): max_workers_per_user, max_total_workers"
```

---

## Task 3: `db_scoped.py` — helper de isolamento

**Files:**
- Create: `backend/app/db_scoped.py`
- Test: `backend/tests/test_db_scoped.py`

- [ ] **Step 1: Escrever testes (RED)**

```python
# backend/tests/test_db_scoped.py
import pytest
from unittest.mock import MagicMock
from app.db_scoped import scoped, TENANT_TABLES


@pytest.fixture
def fake_db():
    db = MagicMock()
    db.table.return_value = MagicMock()
    return db


def test_scoped_rejects_non_tenant_table(fake_db):
    with pytest.raises(ValueError, match="não é tabela tenant"):
        scoped(fake_db, "user_bank_credentials", "u1")


def test_scoped_select_forces_owner_filter(fake_db):
    q = fake_db.table.return_value
    q.select.return_value.eq.return_value = q
    scoped(fake_db, "v8_leads", "u1").select("*").execute()
    q.select.assert_called_with("*")
    q.select.return_value.eq.assert_called_with("owner_id", "u1")


def test_scoped_insert_injects_owner_id_dict(fake_db):
    q = fake_db.table.return_value
    q.insert.return_value = q
    scoped(fake_db, "v8_leads", "u1").insert({"cpf": "123"}).execute()
    q.insert.assert_called_with({"cpf": "123", "owner_id": "u1"})


def test_scoped_insert_injects_owner_id_list(fake_db):
    q = fake_db.table.return_value
    q.insert.return_value = q
    scoped(fake_db, "v8_leads", "u1").insert([{"cpf": "1"}, {"cpf": "2"}]).execute()
    q.insert.assert_called_with([{"cpf": "1", "owner_id": "u1"}, {"cpf": "2", "owner_id": "u1"}])


def test_scoped_update_forces_owner_filter(fake_db):
    q = fake_db.table.return_value
    q.update.return_value.eq.return_value = q
    scoped(fake_db, "v8_leads", "u1").update({"status": "ok"}).eq("cpf", "123").execute()
    q.update.assert_called_with({"status": "ok"})
    q.update.return_value.eq.assert_called_with("owner_id", "u1")


def test_scoped_upsert_injects_owner_id(fake_db):
    q = fake_db.table.return_value
    q.upsert.return_value = q
    scoped(fake_db, "v8_leads", "u1").upsert({"cpf": "123"}, on_conflict="cpf,owner_id").execute()
    q.upsert.assert_called_with({"cpf": "123", "owner_id": "u1"}, on_conflict="cpf,owner_id")


def test_scoped_delete_forces_owner_filter(fake_db):
    q = fake_db.table.return_value
    q.delete.return_value.eq.return_value = q
    scoped(fake_db, "v8_leads", "u1").delete().eq("cpf", "123").execute()
    q.delete.return_value.eq.assert_called_with("owner_id", "u1")


def test_scoped_supports_postgrest_filters(fake_db):
    q = fake_db.table.return_value
    q.select.return_value.eq.return_value = q
    for m in ("neq", "gt", "gte", "lt", "lte", "is_", "like", "ilike", "order", "limit", "range", "single", "maybe_single"):
        getattr(q, m).return_value = q
    sq = scoped(fake_db, "v8_leads", "u1").select("*")
    sq.neq("status", "x").gt("v", 0).gte("v", 0).lt("v", 9).lte("v", 9) \
      .is_("c", None).like("n", "a%").ilike("n", "a%") \
      .order("created_at").limit(10).range(0, 9).single().execute()
    # smoke: nenhuma exceção, todos os métodos foram chamados


def test_tenant_tables_constant():
    assert TENANT_TABLES == {"v8_leads", "v8_bot_runs"}
```

- [ ] **Step 2: Rodar testes (devem FALHAR — módulo não existe)**

Run: `cd backend && pytest tests/test_db_scoped.py -v`
Expected: FAIL com `ModuleNotFoundError: app.db_scoped`

- [ ] **Step 3: Implementar (GREEN)**

```python
# backend/app/db_scoped.py
from typing import Any

TENANT_TABLES: set[str] = {"v8_leads", "v8_bot_runs"}


def scoped(db: Any, table_name: str, user_id: str):
    if table_name not in TENANT_TABLES:
        raise ValueError(f"{table_name!r} não é tabela tenant; use db.table() direto")
    return _ScopedQuery(db.table(table_name), user_id)


class _ScopedQuery:
    def __init__(self, q, user_id: str):
        self._q = q
        self._user_id = user_id

    def select(self, cols: str = "*"):
        return _ScopedQuery(self._q.select(cols).eq("owner_id", self._user_id), self._user_id)

    def insert(self, payload):
        if isinstance(payload, list):
            payload = [{**p, "owner_id": self._user_id} for p in payload]
        else:
            payload = {**payload, "owner_id": self._user_id}
        return _ScopedQuery(self._q.insert(payload), self._user_id)

    def update(self, payload):
        return _ScopedQuery(self._q.update(payload).eq("owner_id", self._user_id), self._user_id)

    def upsert(self, payload, on_conflict: str | None = None):
        if isinstance(payload, list):
            payload = [{**p, "owner_id": self._user_id} for p in payload]
        else:
            payload = {**payload, "owner_id": self._user_id}
        kw = {"on_conflict": on_conflict} if on_conflict is not None else {}
        return _ScopedQuery(self._q.upsert(payload, **kw), self._user_id)

    def delete(self):
        return _ScopedQuery(self._q.delete().eq("owner_id", self._user_id), self._user_id)

    def eq(self, col, val):     return _ScopedQuery(self._q.eq(col, val), self._user_id)
    def neq(self, col, val):    return _ScopedQuery(self._q.neq(col, val), self._user_id)
    def gt(self, col, val):     return _ScopedQuery(self._q.gt(col, val), self._user_id)
    def gte(self, col, val):    return _ScopedQuery(self._q.gte(col, val), self._user_id)
    def lt(self, col, val):     return _ScopedQuery(self._q.lt(col, val), self._user_id)
    def lte(self, col, val):    return _ScopedQuery(self._q.lte(col, val), self._user_id)
    def in_(self, col, vals):   return _ScopedQuery(self._q.in_(col, vals), self._user_id)
    def is_(self, col, val):    return _ScopedQuery(self._q.is_(col, val), self._user_id)
    def like(self, col, pat):   return _ScopedQuery(self._q.like(col, pat), self._user_id)
    def ilike(self, col, pat):  return _ScopedQuery(self._q.ilike(col, pat), self._user_id)
    def order(self, *a, **k):   return _ScopedQuery(self._q.order(*a, **k), self._user_id)
    def limit(self, n):         return _ScopedQuery(self._q.limit(n), self._user_id)
    def range(self, lo, hi):    return _ScopedQuery(self._q.range(lo, hi), self._user_id)
    def single(self):           return _ScopedQuery(self._q.single(), self._user_id)
    def maybe_single(self):     return _ScopedQuery(self._q.maybe_single(), self._user_id)

    def execute(self):          return self._q.execute()
```

- [ ] **Step 4: Rodar testes (PASS)**

Run: `cd backend && pytest tests/test_db_scoped.py -v`
Expected: 9 passed

- [ ] **Step 5: Commit**

```bash
git add backend/app/db_scoped.py backend/tests/test_db_scoped.py
git commit -m "feat(db): scoped() helper com superfície postgrest completa"
```

---

## Task 4: Lint AST anti-bypass

**Files:**
- Create: `backend/tests/test_no_unscoped_tenant_access.py`

- [ ] **Step 1: Escrever o teste**

```python
# backend/tests/test_no_unscoped_tenant_access.py
"""
Lint estático: nenhum arquivo fora do allowlist pode chamar
db.table("v8_leads") ou db.table("v8_bot_runs") direto.
Use scoped(db, "<table>", user_id).
"""
import ast
import pathlib

TENANT_TABLES = {"v8_leads", "v8_bot_runs"}

# Apenas estes arquivos podem chamar .table() com tabela tenant.
# webhook.py precisa resolver owner_id antes do scoped();
# db_scoped.py é o próprio helper.
ALLOWLIST = {
    "app/db_scoped.py",
    "app/routers/webhook.py",
}

ROOT = pathlib.Path(__file__).resolve().parents[1] / "app"


def _scan(py: pathlib.Path) -> list[str]:
    offenders: list[str] = []
    tree = ast.parse(py.read_text())
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        if not isinstance(node.func, ast.Attribute) or node.func.attr != "table":
            continue
        if not node.args:
            continue
        arg = node.args[0]
        if isinstance(arg, ast.Constant) and arg.value in TENANT_TABLES:
            offenders.append(f"{py}:{node.lineno} db.table({arg.value!r})")
    return offenders


def test_no_unscoped_tenant_table_access():
    offenders: list[str] = []
    for py in ROOT.rglob("*.py"):
        rel = "app/" + str(py.relative_to(ROOT)).replace("\\", "/")
        if rel in ALLOWLIST:
            continue
        offenders.extend(_scan(py))
    assert not offenders, (
        "Use scoped(db, '<table>', user_id) em vez de db.table() pra tabelas tenant:\n"
        + "\n".join(offenders)
    )
```

- [ ] **Step 2: Rodar (vai FALHAR — código atual usa `.table("v8_leads")` em vários lugares)**

Run: `cd backend && pytest tests/test_no_unscoped_tenant_access.py -v`
Expected: FAIL listando ofensores em `services/worker.py`, `routers/leads.py`, `routers/bot.py`, `routers/stats.py`, `services/bot_service.py` etc.

**O teste vira green ao longo das tasks 8-13.** Não commitar como passing ainda — é o gate final.

- [ ] **Step 3: Commit (mesmo failing — é o quality gate)**

```bash
git add backend/tests/test_no_unscoped_tenant_access.py
git commit -m "test(lint): AST gate — banir db.table() direto em tabelas tenant"
```

---

## Task 5: `banks/v8/credentials_helper.py`

**Files:**
- Create: `backend/app/banks/__init__.py` (vazio)
- Create: `backend/app/banks/v8/__init__.py` (vazio)
- Create: `backend/app/banks/v8/credentials_helper.py`
- Test: `backend/tests/test_v8_credentials_helper.py`

- [ ] **Step 1: Escrever testes (RED)**

```python
# backend/tests/test_v8_credentials_helper.py
import pytest
from unittest.mock import MagicMock
from fastapi import HTTPException
from app.banks.v8.credentials_helper import get_v8_runtime_creds
from app.credentials.service import BankCredentials


def _svc_returning(creds):
    svc = MagicMock()
    svc.get.return_value = creds
    return svc


def test_returns_creds_when_cadastrada(monkeypatch):
    creds = BankCredentials(user_id="u1", bank_code="v8", login="alice", password="pw", proxies=[])
    svc = _svc_returning(creds)
    monkeypatch.setattr("app.banks.v8.credentials_helper.CredentialService", lambda db: svc)
    out = get_v8_runtime_creds("u1", db=MagicMock())
    assert out is creds
    svc.get.assert_called_once_with("u1", "v8")


def test_raises_400_when_missing(monkeypatch):
    svc = _svc_returning(None)
    monkeypatch.setattr("app.banks.v8.credentials_helper.CredentialService", lambda db: svc)
    with pytest.raises(HTTPException) as ei:
        get_v8_runtime_creds("u1", db=MagicMock())
    assert ei.value.status_code == 400
    assert "credenciais V8 não cadastradas" in ei.value.detail


def test_raises_400_when_login_missing(monkeypatch):
    creds = BankCredentials(user_id="u1", bank_code="v8", login=None, password="pw", proxies=[])
    svc = _svc_returning(creds)
    monkeypatch.setattr("app.banks.v8.credentials_helper.CredentialService", lambda db: svc)
    with pytest.raises(HTTPException) as ei:
        get_v8_runtime_creds("u1", db=MagicMock())
    assert ei.value.status_code == 400


def test_raises_400_when_password_missing(monkeypatch):
    creds = BankCredentials(user_id="u1", bank_code="v8", login="x", password=None, proxies=[])
    svc = _svc_returning(creds)
    monkeypatch.setattr("app.banks.v8.credentials_helper.CredentialService", lambda db: svc)
    with pytest.raises(HTTPException) as ei:
        get_v8_runtime_creds("u1", db=MagicMock())
    assert ei.value.status_code == 400
```

- [ ] **Step 2: Rodar testes (FAIL — módulo não existe)**

Run: `cd backend && pytest tests/test_v8_credentials_helper.py -v`

- [ ] **Step 3: Implementar**

```python
# backend/app/banks/__init__.py  -- vazio
```

```python
# backend/app/banks/v8/__init__.py  -- vazio
```

```python
# backend/app/banks/v8/credentials_helper.py
from typing import Any
from fastapi import HTTPException
from ...credentials.service import CredentialService, BankCredentials


def get_v8_runtime_creds(user_id: str, db: Any) -> BankCredentials:
    """Busca credenciais V8 do user. Levanta 400 se não houver login+password.

    Sem fallback pro .env: regra de produto é estrita.
    """
    creds = CredentialService(db).get(user_id, "v8")
    if creds is None or not creds.login or not creds.password:
        raise HTTPException(
            status_code=400,
            detail="credenciais V8 não cadastradas. Cadastre em /api/credentials/v8 antes de usar.",
        )
    return creds
```

- [ ] **Step 4: Rodar (PASS)**

Run: `cd backend && pytest tests/test_v8_credentials_helper.py -v`
Expected: 4 passed

- [ ] **Step 5: Commit**

```bash
git add backend/app/banks/ backend/tests/test_v8_credentials_helper.py
git commit -m "feat(v8): credentials_helper — sem fallback, 400 sem creds"
```

---

## Task 6: `banks/v8/auth.py` — token cache com lock por user

**Files:**
- Create: `backend/app/banks/v8/auth.py`
- Test: `backend/tests/test_v8_auth_token_cache.py`

- [ ] **Step 1: Escrever testes (RED)**

```python
# backend/tests/test_v8_auth_token_cache.py
import asyncio
import time
import pytest
from unittest.mock import AsyncMock
from app.banks.v8 import auth as auth_mod


@pytest.fixture(autouse=True)
def reset_caches():
    auth_mod._token_cache.clear()
    auth_mod._locks.clear()
    yield
    auth_mod._token_cache.clear()
    auth_mod._locks.clear()


@pytest.mark.asyncio
async def test_first_call_fetches(monkeypatch):
    fetch = AsyncMock(return_value=("tok-A", time.time() + 3600))
    monkeypatch.setattr(auth_mod, "_fetch_token", fetch)
    t = await auth_mod.get_token("u1", "alice", "pw")
    assert t == "tok-A"
    fetch.assert_awaited_once_with("alice", "pw")


@pytest.mark.asyncio
async def test_second_call_uses_cache(monkeypatch):
    fetch = AsyncMock(return_value=("tok-A", time.time() + 3600))
    monkeypatch.setattr(auth_mod, "_fetch_token", fetch)
    await auth_mod.get_token("u1", "alice", "pw")
    await auth_mod.get_token("u1", "alice", "pw")
    fetch.assert_awaited_once()  # só uma vez


@pytest.mark.asyncio
async def test_different_users_separate_cache(monkeypatch):
    fetch = AsyncMock(side_effect=[("tok-A", time.time() + 3600), ("tok-B", time.time() + 3600)])
    monkeypatch.setattr(auth_mod, "_fetch_token", fetch)
    a = await auth_mod.get_token("u1", "alice", "pw")
    b = await auth_mod.get_token("u2", "bob", "pw")
    assert a == "tok-A"
    assert b == "tok-B"
    assert fetch.await_count == 2


@pytest.mark.asyncio
async def test_concurrent_calls_serialize_per_user(monkeypatch):
    """5 chamadas paralelas pro mesmo user → só 1 _fetch_token."""
    started = asyncio.Event()
    proceed = asyncio.Event()
    counter = {"n": 0}

    async def slow_fetch(login, password):
        counter["n"] += 1
        started.set()
        await proceed.wait()
        return ("tok", time.time() + 3600)

    monkeypatch.setattr(auth_mod, "_fetch_token", slow_fetch)
    tasks = [asyncio.create_task(auth_mod.get_token("u1", "alice", "pw")) for _ in range(5)]
    await started.wait()
    proceed.set()
    results = await asyncio.gather(*tasks)
    assert all(r == "tok" for r in results)
    assert counter["n"] == 1


@pytest.mark.asyncio
async def test_invalidate_forces_refetch(monkeypatch):
    fetch = AsyncMock(side_effect=[("tok-A", time.time() + 3600), ("tok-B", time.time() + 3600)])
    monkeypatch.setattr(auth_mod, "_fetch_token", fetch)
    a = await auth_mod.get_token("u1", "alice", "pw")
    auth_mod.invalidate("u1")
    b = await auth_mod.get_token("u1", "alice", "pw")
    assert a == "tok-A"
    assert b == "tok-B"
    assert fetch.await_count == 2


@pytest.mark.asyncio
async def test_expired_token_refetches(monkeypatch):
    fetch = AsyncMock(side_effect=[("tok-A", time.time() + 10), ("tok-B", time.time() + 3600)])
    monkeypatch.setattr(auth_mod, "_fetch_token", fetch)
    await auth_mod.get_token("u1", "alice", "pw")
    # força "expirado" zerando o expires_at no cache
    auth_mod._token_cache["u1"] = ("tok-A", time.time() - 1)
    b = await auth_mod.get_token("u1", "alice", "pw")
    assert b == "tok-B"
    assert fetch.await_count == 2
```

- [ ] **Step 2: Rodar (FAIL)**

Run: `cd backend && pytest tests/test_v8_auth_token_cache.py -v`

- [ ] **Step 3: Implementar**

```python
# backend/app/banks/v8/auth.py
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
```

- [ ] **Step 4: Rodar (PASS)**

Run: `cd backend && pytest tests/test_v8_auth_token_cache.py -v`
Expected: 6 passed

- [ ] **Step 5: Commit**

```bash
git add backend/app/banks/v8/auth.py backend/tests/test_v8_auth_token_cache.py
git commit -m "feat(v8): auth com lock e cache por user_id"
```

---

## Task 7: `services/v8_api_service.py` — receber token explícito

**Files:**
- Modify: `backend/app/services/v8_api_service.py`
- Test: existente (smoke) — adicionar 1 teste

- [ ] **Step 1: Refatorar — toda função recebe `token` em vez de chamar `get_token()`**

Substituir o conteúdo de `_headers()` e adicionar parâmetro `token` em todas as funções públicas:

```python
# backend/app/services/v8_api_service.py (mudanças)
# REMOVER: from .auth_service import get_token
# REMOVER: async def _headers() -> dict: ... (a função antiga sem args)

def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
```

E em cada função pública (`enrich_cpf`, `create_consent`, `authorize_consent`, `get_simulation_configs`, `create_simulation`, `get_consult`):

- Adicionar `token: str` como **primeiro** argumento posicional
- Trocar `headers=await _headers()` por `headers=_headers(token)`

Exemplo (`enrich_cpf`):

```python
async def enrich_cpf(token: str, cpf: str, proxy: str | None = None) -> dict:
    async with _client(proxy) as client:
        resp = await client.get(
            f"{BASE}/private-consignment/consult/client-data/basic/{cpf}",
            headers=_headers(token),
            timeout=20,
        )
        _raise_v8(resp, "enrich_cpf")
        return resp.json()
```

Aplicar mudança análoga em **todas** as funções do arquivo. Manter `pick_config`, `_max_installments`, `V8APIError`, `_raise_v8`, `_client` inalterados.

- [ ] **Step 2: Adicionar teste smoke**

```python
# backend/tests/test_v8_api_service_signatures.py
"""Smoke: garante que todas as funções V8 públicas aceitam token explícito."""
import inspect
from app.services import v8_api_service as v8

PUBLIC_FNS = ["enrich_cpf", "create_consent", "authorize_consent",
              "get_simulation_configs", "create_simulation", "get_consult"]


def test_all_public_fns_accept_token_first():
    for name in PUBLIC_FNS:
        fn = getattr(v8, name)
        sig = inspect.signature(fn)
        params = list(sig.parameters.values())
        assert params, f"{name} sem args"
        assert params[0].name == "token", f"{name} primeiro arg deveria ser 'token', tem {params[0].name!r}"
        assert params[0].annotation is str
```

- [ ] **Step 3: Rodar**

Run: `cd backend && pytest tests/test_v8_api_service_signatures.py -v`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add backend/app/services/v8_api_service.py backend/tests/test_v8_api_service_signatures.py
git commit -m "refactor(v8 api): token como primeiro arg em todas as funções"
```

---

## Task 8: `banks/v8/worker.py` — `LeadWorker` com creds injetadas

**Files:**
- Create: `backend/app/banks/v8/worker.py` (cópia adaptada de `services/worker.py`)
- Modify: `backend/app/services/worker.py` (vira shim)

- [ ] **Step 1: Criar `banks/v8/worker.py`**

Copiar o conteúdo de `backend/app/services/worker.py` e aplicar as mudanças:

1. Imports: trocar `from ..config import settings` por nada; trocar imports de `.v8_api_service` para o caminho absoluto via `from ...services.v8_api_service import ...` mantendo as mesmas funções.
2. Importar `from .auth import get_token, invalidate as invalidate_token`.
3. Importar `from ...db_scoped import scoped`.
4. Importar `from ...credentials.service import BankCredentials`.
5. `__init__` muda assinatura:

```python
class LeadWorker:
    def __init__(
        self,
        worker_id: int,
        user_id: str,
        creds: BankCredentials,
        db,
        on_event: Callable,
        role: str = "full",
        role_index: int = 0,
    ):
        self.worker_id = worker_id
        self.user_id = user_id
        self.creds = creds
        self.db = db
        self.on_event = on_event
        self.role = role
        self.role_index = role_index
        self.name = self._build_name(role, role_index)
        self._current_nome: str | None = None
        proxies = creds.proxies or []
        self.proxy = proxies[worker_id % len(proxies)] if proxies else None
        if self.proxy:
            host = self.proxy.split("@")[-1]
            logger.info(f"{self.name} usando proxy {host}")
        else:
            logger.info(f"{self.name} sem proxy (cliente não cadastrou; rodando direto)")
```

6. `_update_lead` usa `scoped`:

```python
    async def _update_lead(self, cpf: str, updates: dict):
        await asyncio.to_thread(
            lambda: scoped(self.db, "v8_leads", self.user_id).update(updates).eq("cpf", cpf).execute()
        )
```

7. Toda chamada V8 passa `token` como primeiro arg:

```python
    async def _token(self) -> str:
        return await get_token(self.user_id, self.creds.login, self.creds.password)
```

E nos callsites: `await enrich_cpf(await self._token(), cpf, proxy=self.proxy)`, `await get_simulation_configs(await self._token(), proxy=self.proxy)`, `await create_simulation(await self._token(), consult_id, ..., proxy=self.proxy)`, `await create_consent(await self._token(), cpf, client_data, telefone, proxy=self.proxy)`, `await authorize_consent(await self._token(), consult_id, proxy=self.proxy)`, `await get_consult(await self._token(), consult_id, proxy=self.proxy)`.

8. Em `_poll_consult`, mesma substituição.

9. No bloco `except V8APIError as e:` adicionar invalidação em 401/429:

```python
        except V8APIError as e:
            if e.status in (401, 429):
                invalidate_token(self.user_id)
                logger.warning(f"V8 {e.status} pra user {self.user_id} — token invalidado")
            logger.error(f"Worker {self.worker_id} CPF {cpf}: {e} — agendando retry")
            ...
```

10. `_emit` adiciona `user_id`:

```python
    def _emit(self, type: str, cpf: str = None, status: str = None, message: str = None, nome: str | None = None):
        self.on_event({
            "type": type,
            "user_id": self.user_id,  # <-- novo
            "worker_id": self.worker_id,
            ...
        })
```

- [ ] **Step 2: Trocar `services/worker.py` por shim**

```python
# backend/app/services/worker.py
"""DEPRECATED: re-exporta de banks/v8/worker.py durante transição (Plano 2 → 5)."""
from ..banks.v8.worker import LeadWorker  # noqa: F401
```

- [ ] **Step 3: Rodar suite**

Run: `cd backend && pytest -q`
Expected: testes existentes passam (lint AST ainda falha — aceitável até Task 13).

- [ ] **Step 4: Commit**

```bash
git add backend/app/banks/v8/worker.py backend/app/services/worker.py
git commit -m "refactor(v8): LeadWorker em banks/v8 com creds + scoped queries"
```

---

## Task 9: `banks/v8/bot_pool.py` — pool por user com tetos

**Files:**
- Create: `backend/app/banks/v8/bot_pool.py`
- Test: `backend/tests/test_v8_bot_pool.py`

- [ ] **Step 1: Escrever testes (RED)**

```python
# backend/tests/test_v8_bot_pool.py
import pytest
from unittest.mock import MagicMock, AsyncMock
from fastapi import HTTPException
from app.banks.v8.bot_pool import V8BotPool, RunHandle


@pytest.fixture
def fake_creds():
    c = MagicMock()
    c.login = "alice"; c.password = "pw"; c.proxies = []
    return c


@pytest.fixture
def fake_db():
    db = MagicMock()
    return db


@pytest.fixture(autouse=True)
def small_caps(monkeypatch):
    from app.banks.v8 import bot_pool
    monkeypatch.setattr(bot_pool, "_settings_max_per_user", lambda: 3)
    monkeypatch.setattr(bot_pool, "_settings_max_total", lambda: 5)


@pytest.mark.asyncio
async def test_start_creates_run_for_user(fake_creds, fake_db, monkeypatch):
    pool = V8BotPool()
    monkeypatch.setattr(pool, "_spawn_workers", AsyncMock(return_value=None))
    monkeypatch.setattr(pool, "_persist_run", AsyncMock(return_value="run-1"))
    h = await pool.start("u1", num_workers=2, creds=fake_creds, db=fake_db)
    assert isinstance(h, RunHandle)
    assert h.user_id == "u1"
    assert h.num_workers == 2
    assert pool.status("u1") is not None


@pytest.mark.asyncio
async def test_second_start_same_user_409(fake_creds, fake_db, monkeypatch):
    pool = V8BotPool()
    monkeypatch.setattr(pool, "_spawn_workers", AsyncMock(return_value=None))
    monkeypatch.setattr(pool, "_persist_run", AsyncMock(return_value="run-1"))
    await pool.start("u1", 2, fake_creds, fake_db)
    with pytest.raises(HTTPException) as ei:
        await pool.start("u1", 2, fake_creds, fake_db)
    assert ei.value.status_code == 409


@pytest.mark.asyncio
async def test_two_users_parallel_ok(fake_creds, fake_db, monkeypatch):
    pool = V8BotPool()
    monkeypatch.setattr(pool, "_spawn_workers", AsyncMock(return_value=None))
    monkeypatch.setattr(pool, "_persist_run", AsyncMock(return_value="run-1"))
    await pool.start("u1", 2, fake_creds, fake_db)
    await pool.start("u2", 2, fake_creds, fake_db)
    assert pool.status("u1") and pool.status("u2")


@pytest.mark.asyncio
async def test_per_user_cap_clamps(fake_creds, fake_db, monkeypatch):
    pool = V8BotPool()
    monkeypatch.setattr(pool, "_spawn_workers", AsyncMock(return_value=None))
    monkeypatch.setattr(pool, "_persist_run", AsyncMock(return_value="run-1"))
    h = await pool.start("u1", num_workers=99, creds=fake_creds, db=fake_db)
    assert h.num_workers == 3  # clamped a max_workers_per_user


@pytest.mark.asyncio
async def test_global_cap_503(fake_creds, fake_db, monkeypatch):
    pool = V8BotPool()
    monkeypatch.setattr(pool, "_spawn_workers", AsyncMock(return_value=None))
    monkeypatch.setattr(pool, "_persist_run", AsyncMock(return_value="run-1"))
    await pool.start("u1", 3, fake_creds, fake_db)  # 3
    await pool.start("u2", 2, fake_creds, fake_db)  # 5 total
    with pytest.raises(HTTPException) as ei:
        await pool.start("u3", 1, fake_creds, fake_db)  # passaria de 5
    assert ei.value.status_code == 503


@pytest.mark.asyncio
async def test_stop_isolates(fake_creds, fake_db, monkeypatch):
    pool = V8BotPool()
    monkeypatch.setattr(pool, "_spawn_workers", AsyncMock(return_value=None))
    monkeypatch.setattr(pool, "_persist_run", AsyncMock(return_value="run-1"))
    await pool.start("u1", 2, fake_creds, fake_db)
    await pool.start("u2", 2, fake_creds, fake_db)
    await pool.stop("u1")
    assert pool.status("u1") is None
    assert pool.status("u2") is not None
```

- [ ] **Step 2: Rodar (FAIL)**

Run: `cd backend && pytest tests/test_v8_bot_pool.py -v`

- [ ] **Step 3: Implementar**

```python
# backend/app/banks/v8/bot_pool.py
import asyncio
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable
from fastapi import HTTPException

from ...config import settings


def _settings_max_per_user() -> int: return settings.max_workers_per_user
def _settings_max_total()   -> int: return settings.max_total_workers


@dataclass
class RunHandle:
    user_id: str
    run_id: str
    num_workers: int
    started_at: datetime
    tasks: list[asyncio.Task] = field(default_factory=list)
    listeners: list[Callable] = field(default_factory=list)


class V8BotPool:
    def __init__(self):
        self._runs: dict[str, RunHandle] = {}
        self._lock = asyncio.Lock()

    async def start(self, user_id: str, num_workers: int, creds: Any, db: Any) -> RunHandle:
        async with self._lock:
            if user_id in self._runs:
                raise HTTPException(status_code=409, detail="bot já em execução")
            n = max(1, min(num_workers, _settings_max_per_user()))
            running_total = sum(r.num_workers for r in self._runs.values())
            if running_total + n > _settings_max_total():
                raise HTTPException(
                    status_code=503,
                    detail=f"capacidade do servidor cheia ({running_total}/{_settings_max_total()}). Tente novamente em instantes.",
                )
            run_id = await self._persist_run(user_id, n, db)
            handle = RunHandle(user_id=user_id, run_id=run_id, num_workers=n,
                               started_at=datetime.now(timezone.utc))
            self._runs[user_id] = handle
        await self._spawn_workers(handle, creds, db)
        return handle

    async def stop(self, user_id: str) -> None:
        async with self._lock:
            handle = self._runs.pop(user_id, None)
        if not handle:
            return
        for t in handle.tasks:
            t.cancel()

    def status(self, user_id: str) -> RunHandle | None:
        return self._runs.get(user_id)

    def emit(self, user_id: str, event: dict) -> None:
        handle = self._runs.get(user_id)
        if not handle:
            return
        for listener in handle.listeners:
            try:
                listener(event)
            except Exception:
                pass

    # extension points (overridable em testes)
    async def _persist_run(self, user_id: str, n: int, db: Any) -> str:
        from ...db_scoped import scoped
        resp = await asyncio.to_thread(
            lambda: scoped(db, "v8_bot_runs", user_id).insert({
                "num_workers": n,
                "status": "running",
            }).execute()
        )
        return resp.data[0]["id"]

    async def _spawn_workers(self, handle: RunHandle, creds: Any, db: Any) -> None:
        # intencionalmente vazio aqui — Task 10 conecta com LeadWorker
        # (o controle real de fila/loop fica em bot_service refatorado)
        pass
```

- [ ] **Step 4: Rodar (PASS)**

Run: `cd backend && pytest tests/test_v8_bot_pool.py -v`
Expected: 6 passed

- [ ] **Step 5: Commit**

```bash
git add backend/app/banks/v8/bot_pool.py backend/tests/test_v8_bot_pool.py
git commit -m "feat(v8): bot_pool por user com tetos per-user e global"
```

---

## Task 10: `services/bot_service.py` — delegar pra `V8BotPool`

**Files:**
- Modify: `backend/app/services/bot_service.py`

- [ ] **Step 1: Refatorar bot_service**

`bot_service` hoje gerencia uma fila Redis e workers globais. Vamos preservar a lógica de fila/workers, mas passar a operar no contexto de um `RunHandle` (user-scoped). A função `start_bot(num_workers)` vira `start_bot(user_id, num_workers, creds, db)` e:

1. Chama `pool.start(user_id, num_workers, creds, db)` pra criar o handle.
2. Spawna N `LeadWorker(worker_id=i, user_id=user_id, creds=creds, db=db, on_event=lambda ev: pool.emit(user_id, ev), ...)`.
3. As tasks ficam em `handle.tasks`.

`stop_bot(user_id)` chama `pool.stop(user_id)`.

`bot_status(user_id)` retorna projeção do `pool.status(user_id)`.

A leitura de leads pendentes (hoje `db().table("v8_leads").select(...).eq("status","pendente")`) vira `scoped(db, "v8_leads", user_id).select(...).eq("status","pendente")`.

(Mostre o diff completo no commit; não dá pra reproduzir o arquivo inteiro aqui sem perder fidelidade ao código atual. Engineer deve abrir `bot_service.py` e aplicar a refatoração mantendo a semântica de fila Redis + lifecycle.)

- [ ] **Step 2: Rodar suite (lint AST melhora; testes funcionais devem continuar)**

Run: `cd backend && pytest -q --ignore=backend/tests/test_no_unscoped_tenant_access.py`

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/bot_service.py
git commit -m "refactor(bot): bot_service delega pra V8BotPool, scoped queries"
```

---

## Task 11: Routers — `leads.py`, `bot.py`, `stats.py`

**Files:**
- Modify: `backend/app/routers/leads.py`
- Modify: `backend/app/routers/bot.py`
- Modify: `backend/app/routers/stats.py`

- [ ] **Step 1: Padronizar dependency injection**

Em cada handler que toca `v8_leads` ou `v8_bot_runs`:

```python
from ..auth_deps import require_user, AuthUser
from ..db_scoped import scoped
from ..database import get_db
from ..banks.v8.credentials_helper import get_v8_runtime_creds

@router.get("")
def list_leads(
    user: AuthUser = Depends(require_user),
    db = Depends(get_db),
):
    rows = scoped(db, "v8_leads", user.user_id).select("*").order("created_at", desc=True).execute()
    return rows.data
```

Trocar **toda** ocorrência de `db().table("v8_leads")` ou `db().table("v8_bot_runs")` por `scoped(db, "<table>", user.user_id)`. Operações de upload/insert deixam de passar `owner_id` manualmente — `_ScopedQuery.insert` injeta.

Em handlers de consulta individual e upload CSV (`leads.py`), antes de chamar V8 API:

```python
creds = get_v8_runtime_creds(user.user_id, db)
token = await get_token(user.user_id, creds.login, creds.password)
data = await enrich_cpf(token, cpf, proxy=(creds.proxies[0] if creds.proxies else None))
```

Em `bot.py`:

```python
@router.post("/start")
async def start_bot(
    payload: StartBotPayload,
    user: AuthUser = Depends(require_user),
    db = Depends(get_db),
    request: Request = None,
):
    creds = get_v8_runtime_creds(user.user_id, db)  # 400 se sem creds
    handle = await request.app.state.v8_pool.start(
        user_id=user.user_id, num_workers=payload.num_workers, creds=creds, db=db
    )
    return {"run_id": handle.run_id, "num_workers": handle.num_workers, "started_at": handle.started_at}
```

`stop`/`status` análogos via `pool.stop(user.user_id)` / `pool.status(user.user_id)`.

`stats.py`:

```python
@router.get("")
def stats(user: AuthUser = Depends(require_user), db = Depends(get_db)):
    counts = {}
    for status in ("pendente","enriquecido","consentido","autorizado","aguardando_resultado","elegivel","inelegivel","erro"):
        r = scoped(db, "v8_leads", user.user_id).select("id").eq("status", status).execute()
        counts[status] = len(r.data or [])
    return counts
```

- [ ] **Step 2: Adicionar singleton no `main.py`**

```python
# backend/app/main.py — depois de criar `app`
from .banks.v8.bot_pool import V8BotPool
app.state.v8_pool = V8BotPool()
```

- [ ] **Step 3: Rodar suite**

Run: `cd backend && pytest -q --ignore=backend/tests/test_no_unscoped_tenant_access.py`
Expected: PASS

Run: `cd backend && pytest tests/test_no_unscoped_tenant_access.py -v`
Expected: cada vez menos ofensores (idealmente apenas `webhook.py` no allowlist + scoped no helper)

- [ ] **Step 4: Commit**

```bash
git add backend/app/routers/leads.py backend/app/routers/bot.py backend/app/routers/stats.py backend/app/main.py
git commit -m "refactor(routers): leads/bot/stats com scoped + creds por user"
```

---

## Task 12: `routers/webhook.py` — resolver dono e atualizar por id

**Files:**
- Modify: `backend/app/routers/webhook.py`

- [ ] **Step 1: Refatorar**

```python
# backend/app/routers/webhook.py (handler V8)
from fastapi import APIRouter, HTTPException
from ..database import get_db
from ..db_scoped import scoped

router = APIRouter(prefix="/api/webhook", tags=["webhook"])

@router.post("/v8")
async def v8_webhook(payload: dict):
    db = get_db()
    consult_id = payload.get("consult_id") or payload.get("consultId")
    if not consult_id:
        raise HTTPException(400, "consult_id ausente")
    # Resolve linha SEM scoped (única exceção, está no allowlist)
    resp = db.table("v8_leads").select("id, owner_id").eq("consult_id", consult_id).maybe_single().execute()
    row = resp.data
    if not row:
        # consult_id desconhecido — silencioso
        return {"ok": True, "matched": False}
    # update por id (NÃO por consult_id) usando scoped já com owner_id resolvido
    updates = _build_updates_from_v8_payload(payload)  # função existente já faz isso
    scoped(db, "v8_leads", row["owner_id"]).update(updates).eq("id", row["id"]).execute()
    return {"ok": True, "matched": True}
```

`_build_updates_from_v8_payload` é a transformação existente no webhook atual — preservar.

- [ ] **Step 2: Teste de webhook isolation**

```python
# backend/tests/test_webhook_isolation.py
from unittest.mock import MagicMock
from fastapi.testclient import TestClient
from app.main import app


def test_webhook_resolves_owner_and_updates_by_id(monkeypatch):
    db = MagicMock()
    # resolve: encontra owner u-A e id row-1
    resolve = MagicMock()
    resolve.data = {"id": "row-1", "owner_id": "u-A"}
    db.table.return_value.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value = resolve

    # scoped path (interceptamos via monkeypatch no scoped)
    captured = {}
    from app.routers import webhook as webhook_mod

    class FakeScoped:
        def __init__(self, q, uid): self.uid = uid
        def update(self, u): captured["u"] = u; captured["uid"] = self.uid; return self
        def eq(self, c, v): captured[c] = v; return self
        def execute(self): return MagicMock(data=[])

    monkeypatch.setattr(webhook_mod, "scoped", lambda d, t, uid: FakeScoped(None, uid))
    monkeypatch.setattr(webhook_mod, "get_db", lambda: db)

    with TestClient(app) as c:
        r = c.post("/api/webhook/v8", json={"consult_id": "x", "status": "SUCCESS"})
    assert r.status_code == 200
    assert r.json()["matched"] is True
    assert captured["uid"] == "u-A"
    assert captured["id"] == "row-1"  # update por id, não consult_id
```

- [ ] **Step 3: Rodar**

Run: `cd backend && pytest tests/test_webhook_isolation.py -v`

- [ ] **Step 4: Commit**

```bash
git add backend/app/routers/webhook.py backend/tests/test_webhook_isolation.py
git commit -m "refactor(webhook): resolve owner via consult_id, update por id"
```

---

## Task 13: `routers/ws.py` — canal por user_id

**Files:**
- Modify: `backend/app/routers/ws.py`

- [ ] **Step 1: Refatorar conexão WS**

Aceitar JWT no query string (`?token=...`), validar via mesma rotina do `auth_deps`, registrar a connection num dict `dict[user_id, set[WebSocket]]`. O `pool.emit(user_id, event)` registra um listener no `RunHandle.listeners` que faz broadcast só pra connections daquele user.

```python
# backend/app/routers/ws.py
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from ..auth_deps import decode_token  # função interna que valida JWT (extrair se ainda não existe)

router = APIRouter()
connections: dict[str, set[WebSocket]] = {}

@router.websocket("/ws")
async def ws(websocket: WebSocket, token: str = Query(...)):
    try:
        claims = decode_token(token)
        user_id = claims["sub"]
    except Exception:
        await websocket.close(code=1008)
        return
    await websocket.accept()
    connections.setdefault(user_id, set()).add(websocket)
    # registra listener no pool (se houver run ativo)
    pool = websocket.app.state.v8_pool
    handle = pool.status(user_id)
    listener = lambda ev: _safe_send(websocket, ev)
    if handle:
        handle.listeners.append(listener)
    try:
        while True:
            await websocket.receive_text()  # mantém vivo (ou ping/pong)
    except WebSocketDisconnect:
        pass
    finally:
        connections.get(user_id, set()).discard(websocket)
        if handle and listener in handle.listeners:
            handle.listeners.remove(listener)


def _safe_send(ws, ev):
    import asyncio, json
    asyncio.create_task(ws.send_text(json.dumps(ev)))
```

- [ ] **Step 2: Rodar suite**

Run: `cd backend && pytest -q`

- [ ] **Step 3: Commit**

```bash
git add backend/app/routers/ws.py
git commit -m "refactor(ws): canal por user_id; eventos só pro dono"
```

---

## Task 14: `services/auth_service.py` shim + lint AST limpo

**Files:**
- Modify: `backend/app/services/auth_service.py`

- [ ] **Step 1: Trocar por shim que erra propositalmente se chamado**

```python
# backend/app/services/auth_service.py
"""DEPRECATED: chamadas diretas ao token global removidas. Use banks/v8/auth.get_token(user_id, login, password)."""
from ..banks.v8.auth import get_token as _user_get_token  # noqa: F401


async def get_token() -> str:
    raise RuntimeError(
        "auth_service.get_token() sem args foi removido. "
        "Use banks.v8.auth.get_token(user_id, login, password)."
    )
```

- [ ] **Step 2: Rodar lint AST — agora deve PASSAR**

Run: `cd backend && pytest tests/test_no_unscoped_tenant_access.py -v`
Expected: PASS

Run: `cd backend && pytest -q`
Expected: tudo PASS

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/auth_service.py
git commit -m "refactor(auth): shim que falha — força migração pro per-user get_token"
```

---

## Task 15: Testes de isolamento end-to-end

**Files:**
- Create: `backend/tests/test_isolation_e2e.py`

- [ ] **Step 1: Escrever testes**

```python
# backend/tests/test_isolation_e2e.py
"""Garante que dados de um user NUNCA vazam pra outro via API."""
import pytest
from unittest.mock import MagicMock
from fastapi.testclient import TestClient
from app.main import app
from app.auth_deps import require_user, AuthUser


USER_A = AuthUser(user_id="aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", email="a@x", is_admin=False, raw={})
USER_B = AuthUser(user_id="bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", email="b@x", is_admin=False, raw={})


class FakeDB:
    """Mini fake do supabase-py: tabela como dict de rows."""
    def __init__(self):
        self.rows: dict[str, list[dict]] = {"v8_leads": [], "v8_bot_runs": []}

    def table(self, name):
        return _FakeQuery(self, name)


class _FakeQuery:
    def __init__(self, db, name):
        self.db = db
        self.name = name
        self._filters = []
        self._action = None
        self._payload = None

    def select(self, _cols="*"): self._action = "select"; return self
    def insert(self, p): self._action = "insert"; self._payload = p; return self
    def update(self, p): self._action = "update"; self._payload = p; return self
    def delete(self):    self._action = "delete"; return self
    def eq(self, c, v):  self._filters.append((c, v)); return self
    def order(self, *a, **k): return self
    def limit(self, n):  return self
    def execute(self):
        rows = self.db.rows[self.name]
        if self._action == "insert":
            payloads = self._payload if isinstance(self._payload, list) else [self._payload]
            for p in payloads:
                p.setdefault("id", f"id-{len(rows)}")
                rows.append(p)
            return MagicMock(data=payloads)
        match = [r for r in rows if all(r.get(c) == v for c, v in self._filters)]
        if self._action == "select":
            return MagicMock(data=match)
        if self._action == "update":
            for r in match: r.update(self._payload)
            return MagicMock(data=match)
        if self._action == "delete":
            for r in match: rows.remove(r)
            return MagicMock(data=match)
        raise NotImplementedError(self._action)


@pytest.fixture
def db():
    return FakeDB()


@pytest.fixture
def client_as(db, monkeypatch):
    """Factory: client_as(USER_A) → TestClient autenticado como A."""
    from app import database
    monkeypatch.setattr(database, "get_db", lambda: db)

    def _make(user):
        app.dependency_overrides[require_user] = lambda: user
        return TestClient(app)
    yield _make
    app.dependency_overrides.clear()


def test_user_a_does_not_see_user_b_leads(client_as, db):
    db.rows["v8_leads"].append({"id":"r1","cpf":"111","status":"elegivel","owner_id":USER_A.user_id})
    db.rows["v8_leads"].append({"id":"r2","cpf":"222","status":"elegivel","owner_id":USER_B.user_id})

    a = client_as(USER_A).get("/api/leads").json()
    b = client_as(USER_B).get("/api/leads").json()
    assert all(r["owner_id"] == USER_A.user_id for r in a)
    assert all(r["owner_id"] == USER_B.user_id for r in b)
    assert {r["cpf"] for r in a} == {"111"}
    assert {r["cpf"] for r in b} == {"222"}


def test_csv_export_isolated(client_as, db):
    db.rows["v8_leads"].append({"id":"r1","cpf":"111","owner_id":USER_A.user_id,"status":"elegivel"})
    db.rows["v8_leads"].append({"id":"r2","cpf":"222","owner_id":USER_B.user_id,"status":"elegivel"})
    csv_a = client_as(USER_A).get("/api/leads/export").text
    assert "111" in csv_a and "222" not in csv_a


def test_stats_isolated(client_as, db):
    for i in range(10):
        db.rows["v8_leads"].append({"id":f"a{i}","cpf":str(i),"status":"elegivel","owner_id":USER_A.user_id})
    for i in range(5):
        db.rows["v8_leads"].append({"id":f"b{i}","cpf":str(i),"status":"elegivel","owner_id":USER_B.user_id})
    sa = client_as(USER_A).get("/api/stats").json()
    sb = client_as(USER_B).get("/api/stats").json()
    assert sa["elegivel"] == 10
    assert sb["elegivel"] == 5


def test_bot_start_without_creds_returns_400(client_as, db, monkeypatch):
    # nenhuma credencial cadastrada → CredentialService.get retorna None
    from app.banks.v8 import credentials_helper
    monkeypatch.setattr(credentials_helper, "CredentialService",
                        lambda d: MagicMock(get=MagicMock(return_value=None)))
    r = client_as(USER_A).post("/api/bot/start", json={"num_workers": 2})
    assert r.status_code == 400
    assert "credenciais V8" in r.json()["detail"]


def test_cpf_dup_between_tenants_allowed(client_as, db):
    """User A e B podem ter o mesmo CPF (não há UNIQUE global)."""
    r1 = client_as(USER_A).post("/api/leads/upload", files={"file": ("x.csv", "cpf\n12345\n", "text/csv")})
    r2 = client_as(USER_B).post("/api/leads/upload", files={"file": ("x.csv", "cpf\n12345\n", "text/csv")})
    assert r1.status_code in (200, 201)
    assert r2.status_code in (200, 201)
    cpfs_a = [r["cpf"] for r in db.rows["v8_leads"] if r["owner_id"] == USER_A.user_id]
    cpfs_b = [r["cpf"] for r in db.rows["v8_leads"] if r["owner_id"] == USER_B.user_id]
    assert "12345" in cpfs_a and "12345" in cpfs_b
```

- [ ] **Step 2: Rodar**

Run: `cd backend && pytest tests/test_isolation_e2e.py -v`
Expected: 5 PASS

- [ ] **Step 3: Commit**

```bash
git add backend/tests/test_isolation_e2e.py
git commit -m "test(isolation): e2e — leads/csv/stats/bot por user"
```

---

## Task 16: Suite final + tag

- [ ] **Step 1: Rodar suite completa**

Run: `cd backend && pytest -v`
Expected: tudo PASS

- [ ] **Step 2: Documentar runbook de prod no MEMORY**

Adicionar uma linha em `~/.claude/projects/-Users-macbookdegabriel-projetos-V8/memory/MEMORY.md` apontando pra spec/plan e marcar Plano 2 como done-local-pending-prod-deploy.

- [ ] **Step 3: Tag e merge**

```bash
git tag plan2-v8-multitenant-complete
```

Não fazer push automático nem aplicar migration em prod — esperar o usuário decidir o momento (mesma estratégia do Plano 1).

---

## Critérios de sucesso

- ✅ Todos os 19+ testes (Tasks 3, 5, 6, 9, 12, 14, 15) passam
- ✅ `test_no_unscoped_tenant_access` PASS (lint AST verde)
- ✅ Migration `003_multitenant_v8.sql` criada com runbook claro
- ✅ Frontend (Plano 4) pode usar imediatamente os endpoints isolados
- ✅ Bot recusa start sem credencial cadastrada (400)
- ✅ 2 users em paralelo: dados não vazam, pools independentes
