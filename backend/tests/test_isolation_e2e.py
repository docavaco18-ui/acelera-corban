"""Garante que dados de um user NUNCA vazam pra outro via API."""
import asyncio
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
        self._filters: list[tuple[str, str, object]] = []
        self._action: str | None = None
        self._payload = None
        self._cols = "*"

    def select(self, cols="*"):
        self._action = "select"
        self._cols = cols
        return self
    def insert(self, p):
        self._action = "insert"; self._payload = p; return self
    def update(self, p):
        self._action = "update"; self._payload = p; return self
    def upsert(self, p, **_kwargs):
        self._action = "upsert"; self._payload = p; return self
    def delete(self):
        self._action = "delete"; return self
    def eq(self, c, v):  self._filters.append(("eq", c, v)); return self
    def neq(self, c, v): self._filters.append(("neq", c, v)); return self
    def gt(self, c, v):  self._filters.append(("gt", c, v)); return self
    def gte(self, c, v): self._filters.append(("gte", c, v)); return self
    def lt(self, c, v):  self._filters.append(("lt", c, v)); return self
    def lte(self, c, v): self._filters.append(("lte", c, v)); return self
    def ilike(self, c, v): return self
    def order(self, *a, **k): return self
    def limit(self, n): return self
    def range(self, lo, hi): self._range = (lo, hi); return self
    def single(self): return self
    def maybe_single(self): self._maybe_single = True; return self

    def _match(self, row) -> bool:
        for op, c, v in self._filters:
            rv = row.get(c)
            if op == "eq" and rv != v: return False
            if op == "neq" and rv == v: return False
        return True

    def execute(self):
        rows = self.db.rows.setdefault(self.name, [])
        if self._action in ("insert", "upsert"):
            payloads = self._payload if isinstance(self._payload, list) else [self._payload]
            inserted = []
            for p in payloads:
                p = {**p}
                p.setdefault("id", f"id-{len(rows)}-{len(inserted)}")
                rows.append(p)
                inserted.append(p)
            return MagicMock(data=inserted)
        match = [r for r in rows if self._match(r)]
        if self._action == "select":
            if getattr(self, "_maybe_single", False):
                return MagicMock(data=match[0] if match else None)
            return MagicMock(data=match)
        if self._action == "update":
            for r in match: r.update(self._payload)
            return MagicMock(data=match)
        if self._action == "delete":
            for r in match:
                rows.remove(r)
            return MagicMock(data=match)
        raise NotImplementedError(self._action)


@pytest.fixture
def db():
    return FakeDB()


@pytest.fixture
def client_as(db, monkeypatch):
    """Factory: client_as(USER_A) → TestClient autenticado como A."""
    from app.routers import leads as leads_mod, stats as stats_mod, bot as bot_mod, webhook as webhook_mod
    from app.services import upload_jobs as upload_mod

    monkeypatch.setattr(leads_mod, "get_db", lambda: db)
    monkeypatch.setattr(stats_mod, "get_db", lambda: db)
    monkeypatch.setattr(bot_mod, "get_db", lambda: db)
    monkeypatch.setattr(webhook_mod, "get_db", lambda: db)
    monkeypatch.setattr(upload_mod, "db", lambda: db)

    def _make(user):
        app.dependency_overrides[require_user] = lambda: user
        return TestClient(app)
    yield _make
    app.dependency_overrides.clear()


def test_user_a_does_not_see_user_b_leads(client_as, db):
    db.rows["v8_leads"].append({"id":"r1","cpf":"111","status":"elegivel","owner_id":USER_A.user_id})
    db.rows["v8_leads"].append({"id":"r2","cpf":"222","status":"elegivel","owner_id":USER_B.user_id})

    a = client_as(USER_A).get("/api/leads/").json()["data"]
    b = client_as(USER_B).get("/api/leads/").json()["data"]
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
    sa = client_as(USER_A).get("/api/stats/dashboard").json()
    sb = client_as(USER_B).get("/api/stats/dashboard").json()
    assert sa["elegiveis"] == 10
    assert sb["elegiveis"] == 5


def test_bot_start_without_creds_returns_400(client_as, db, monkeypatch):
    from app.banks.v8 import credentials_helper
    monkeypatch.setattr(credentials_helper, "CredentialService",
                        lambda d: MagicMock(get=MagicMock(return_value=None)))
    r = client_as(USER_A).post("/api/bot/start")
    assert r.status_code == 400
    assert "credenciais V8" in r.json()["detail"]


def test_cpf_dup_between_tenants_allowed(client_as, db, monkeypatch):
    """User A e B podem ter o mesmo CPF (não há UNIQUE global)."""
    # upload_jobs spawna asyncio.Task com redis — substitui por um sync direto.
    from app.services import upload_jobs as upload_mod

    async def fake_start(content, owner_id, file_name=None):
        leads = upload_mod._parse_csv(content, owner_id)
        from app.db_scoped import scoped
        scoped(db, "v8_leads", owner_id).upsert(leads, on_conflict="owner_id,cpf").execute()
        return {"job_id": "fake-job", "batch_id": "fake-batch"}

    monkeypatch.setattr(upload_mod, "start_upload", fake_start)

    r1 = client_as(USER_A).post("/api/leads/upload", files={"file": ("x.csv", "cpf\n12345\n", "text/csv")})
    r2 = client_as(USER_B).post("/api/leads/upload", files={"file": ("x.csv", "cpf\n12345\n", "text/csv")})
    assert r1.status_code == 202
    assert r2.status_code == 202
    cpfs_a = [r["cpf"] for r in db.rows["v8_leads"] if r["owner_id"] == USER_A.user_id]
    cpfs_b = [r["cpf"] for r in db.rows["v8_leads"] if r["owner_id"] == USER_B.user_id]
    assert "12345" in cpfs_a and "12345" in cpfs_b
