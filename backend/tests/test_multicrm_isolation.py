"""
Cross-tenant isolation tests for Chipcare and Aesir broadcast routers.
User A must NEVER see User B's channels, dispatches, or instances.
Each test uses one authenticated client and verifies only its own data is visible.
"""
import pytest
from unittest.mock import MagicMock
from fastapi.testclient import TestClient
from app.main import app


USER_A_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
USER_B_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"


class FakeDB:
    def __init__(self):
        self.rows: dict[str, list[dict]] = {}

    def table(self, name):
        self.rows.setdefault(name, [])
        return _FakeQuery(self, name)


class _FakeQuery:
    def __init__(self, db, name):
        self.db = db
        self.name = name
        self._filters: list[tuple] = []
        self._action: str | None = None
        self._payload = None
        self._not_mode: bool = False

    def select(self, cols="*"):
        self._action = "select"; return self
    def insert(self, p):
        self._action = "insert"; self._payload = p; return self
    def update(self, p):
        self._action = "update"; self._payload = p; return self
    def upsert(self, p, **_kw):
        self._action = "upsert"; self._payload = p; return self
    def delete(self):
        self._action = "delete"; return self
    def eq(self, c, v):
        op = "neq" if self._not_mode else "eq"
        self._filters.append((op, c, v))
        self._not_mode = False
        return self
    def order(self, *a, **k): return self
    def limit(self, n): return self
    def range(self, lo, hi): return self
    def single(self): return self
    def maybe_single(self): return self

    @property
    def not_(self):
        self._not_mode = True
        return self

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
            return MagicMock(data=match)
        if self._action == "update":
            for r in match: r.update(self._payload)
            return MagicMock(data=match)
        if self._action == "delete":
            for r in match: rows.remove(r)
            return MagicMock(data=match)
        raise NotImplementedError(self._action)


def _chipcare_client(monkeypatch, user_id: str) -> tuple[TestClient, FakeDB]:
    import app.routers.chipcare_broadcast as mod
    fake_db = FakeDB()
    monkeypatch.setattr(mod, "get_db", lambda: fake_db)
    app.dependency_overrides[mod._get_user_id] = lambda: user_id
    return TestClient(app, raise_server_exceptions=True), fake_db


def _aesir_client(monkeypatch, user_id: str) -> tuple[TestClient, FakeDB]:
    import app.routers.aesir_broadcast as mod
    fake_db = FakeDB()
    monkeypatch.setattr(mod, "get_db", lambda: fake_db)
    app.dependency_overrides[mod._get_user_id] = lambda: user_id
    return TestClient(app, raise_server_exceptions=True), fake_db


@pytest.fixture(autouse=True)
def clear_overrides():
    yield
    app.dependency_overrides.clear()


# ── Chipcare channels ─────────────────────────────────────────────────────────

def test_chipcare_user_a_sees_only_own_channels(monkeypatch):
    client, fake_db = _chipcare_client(monkeypatch, USER_A_ID)
    fake_db.rows["chipcare_channels"] = [
        {"channel_id": 1, "owner_id": USER_A_ID, "status": "active"},
        {"channel_id": 2, "owner_id": USER_B_ID, "status": "active"},
    ]
    channels = client.get("/api/chipcare-broadcast/channels").json()
    assert all(c["owner_id"] == USER_A_ID for c in channels)
    assert {c["channel_id"] for c in channels} == {1}


def test_chipcare_user_b_sees_only_own_channels(monkeypatch):
    client, fake_db = _chipcare_client(monkeypatch, USER_B_ID)
    fake_db.rows["chipcare_channels"] = [
        {"channel_id": 1, "owner_id": USER_A_ID, "status": "active"},
        {"channel_id": 2, "owner_id": USER_B_ID, "status": "active"},
    ]
    channels = client.get("/api/chipcare-broadcast/channels").json()
    assert all(c["owner_id"] == USER_B_ID for c in channels)
    assert {c["channel_id"] for c in channels} == {2}


# ── Chipcare dispatches ───────────────────────────────────────────────────────

def test_chipcare_user_a_sees_only_own_dispatches(monkeypatch):
    client, fake_db = _chipcare_client(monkeypatch, USER_A_ID)
    fake_db.rows["chipcare_dispatches"] = [
        {"id": "cd-a", "owner_id": USER_A_ID, "status": "running", "created_at": "2026-01-01"},
        {"id": "cd-b", "owner_id": USER_B_ID, "status": "running", "created_at": "2026-01-01"},
    ]
    disps = client.get("/api/chipcare-broadcast/dispatches").json()
    assert all(d["owner_id"] == USER_A_ID for d in disps)
    assert {d["id"] for d in disps} == {"cd-a"}


def test_chipcare_user_b_sees_only_own_dispatches(monkeypatch):
    client, fake_db = _chipcare_client(monkeypatch, USER_B_ID)
    fake_db.rows["chipcare_dispatches"] = [
        {"id": "cd-a", "owner_id": USER_A_ID, "status": "running", "created_at": "2026-01-01"},
        {"id": "cd-b", "owner_id": USER_B_ID, "status": "running", "created_at": "2026-01-01"},
    ]
    disps = client.get("/api/chipcare-broadcast/dispatches").json()
    assert all(d["owner_id"] == USER_B_ID for d in disps)
    assert {d["id"] for d in disps} == {"cd-b"}


# ── Aesir instances ───────────────────────────────────────────────────────────

def test_aesir_user_a_sees_only_own_instances(monkeypatch):
    client, fake_db = _aesir_client(monkeypatch, USER_A_ID)
    fake_db.rows["aesir_instances"] = [
        {"instance_id": "inst-a", "owner_id": USER_A_ID},
        {"instance_id": "inst-b", "owner_id": USER_B_ID},
    ]
    insts = client.get("/api/aesir-broadcast/instances").json()
    assert all(i["owner_id"] == USER_A_ID for i in insts)
    assert {i["instance_id"] for i in insts} == {"inst-a"}


def test_aesir_user_b_sees_only_own_instances(monkeypatch):
    client, fake_db = _aesir_client(monkeypatch, USER_B_ID)
    fake_db.rows["aesir_instances"] = [
        {"instance_id": "inst-a", "owner_id": USER_A_ID},
        {"instance_id": "inst-b", "owner_id": USER_B_ID},
    ]
    insts = client.get("/api/aesir-broadcast/instances").json()
    assert all(i["owner_id"] == USER_B_ID for i in insts)
    assert {i["instance_id"] for i in insts} == {"inst-b"}


# ── Aesir dispatches ──────────────────────────────────────────────────────────

def test_aesir_user_a_sees_only_own_dispatches(monkeypatch):
    client, fake_db = _aesir_client(monkeypatch, USER_A_ID)
    fake_db.rows["aesir_dispatches"] = [
        {"id": "ad-a", "owner_id": USER_A_ID, "status": "running", "created_at": "2026-01-01"},
        {"id": "ad-b", "owner_id": USER_B_ID, "status": "running", "created_at": "2026-01-01"},
    ]
    disps = client.get("/api/aesir-broadcast/dispatches").json()
    assert all(d["owner_id"] == USER_A_ID for d in disps)
    assert {d["id"] for d in disps} == {"ad-a"}


def test_aesir_user_b_sees_only_own_dispatches(monkeypatch):
    client, fake_db = _aesir_client(monkeypatch, USER_B_ID)
    fake_db.rows["aesir_dispatches"] = [
        {"id": "ad-a", "owner_id": USER_A_ID, "status": "running", "created_at": "2026-01-01"},
        {"id": "ad-b", "owner_id": USER_B_ID, "status": "running", "created_at": "2026-01-01"},
    ]
    disps = client.get("/api/aesir-broadcast/dispatches").json()
    assert all(d["owner_id"] == USER_B_ID for d in disps)
    assert {d["id"] for d in disps} == {"ad-b"}


# ── Cross-tenant action tests ─────────────────────────────────────────────────
# Verifies that mutating actions (activate, cancel, pause) return 404
# when the dispatch_id belongs to a different owner.

def test_chipcare_activate_cross_tenant_returns_404(monkeypatch):
    """User A cannot activate user B's dispatch."""
    client, fake_db = _chipcare_client(monkeypatch, USER_A_ID)
    fake_db.rows["chipcare_dispatches"] = [
        {"id": "cd-b", "owner_id": USER_B_ID, "status": "paused", "chipcare_campaign_id": "cc-99"},
    ]
    r = client.post("/api/chipcare-broadcast/dispatches/cd-b/activate")
    assert r.status_code == 404


def test_chipcare_cancel_cross_tenant_returns_404(monkeypatch):
    """User A cannot cancel user B's dispatch."""
    client, fake_db = _chipcare_client(monkeypatch, USER_A_ID)
    fake_db.rows["chipcare_dispatches"] = [
        {"id": "cd-b", "owner_id": USER_B_ID, "status": "running"},
    ]
    r = client.post("/api/chipcare-broadcast/dispatches/cd-b/cancel")
    assert r.status_code == 404
    # dispatch must remain untouched
    assert fake_db.rows["chipcare_dispatches"][0]["status"] == "running"


def test_chipcare_cancel_own_dispatch_works(monkeypatch):
    """Owner can cancel own dispatch."""
    client, fake_db = _chipcare_client(monkeypatch, USER_A_ID)
    fake_db.rows["chipcare_dispatches"] = [
        {"id": "cd-a", "owner_id": USER_A_ID, "status": "running"},
    ]
    r = client.post("/api/chipcare-broadcast/dispatches/cd-a/cancel")
    assert r.status_code == 200
    assert fake_db.rows["chipcare_dispatches"][0]["status"] == "cancelled"


def test_aesir_pause_cross_tenant_returns_404(monkeypatch):
    """User A cannot pause user B's dispatch."""
    client, fake_db = _aesir_client(monkeypatch, USER_A_ID)
    fake_db.rows["aesir_dispatches"] = [
        {"id": "ad-b", "owner_id": USER_B_ID, "status": "running"},
    ]
    r = client.post("/api/aesir-broadcast/dispatches/ad-b/pause")
    assert r.status_code == 404
    assert fake_db.rows["aesir_dispatches"][0]["status"] == "running"


def test_aesir_cancel_cross_tenant_returns_404(monkeypatch):
    """User A cannot cancel user B's dispatch."""
    client, fake_db = _aesir_client(monkeypatch, USER_A_ID)
    fake_db.rows["aesir_dispatches"] = [
        {"id": "ad-b", "owner_id": USER_B_ID, "status": "running"},
    ]
    r = client.post("/api/aesir-broadcast/dispatches/ad-b/cancel")
    assert r.status_code == 404
    assert fake_db.rows["aesir_dispatches"][0]["status"] == "running"


def test_aesir_cancel_own_dispatch_works(monkeypatch):
    """Owner can cancel own dispatch."""
    client, fake_db = _aesir_client(monkeypatch, USER_A_ID)
    fake_db.rows["aesir_dispatches"] = [
        {"id": "ad-a", "owner_id": USER_A_ID, "status": "running"},
    ]
    r = client.post("/api/aesir-broadcast/dispatches/ad-a/cancel")
    assert r.status_code == 200
    assert fake_db.rows["aesir_dispatches"][0]["status"] == "cancelled"


def test_chipcare_dispatch_cross_tenant_returns_404(monkeypatch):
    """User A cannot trigger dry-run on user B's dispatch_id."""
    client, fake_db = _chipcare_client(monkeypatch, USER_A_ID)
    fake_db.rows["chipcare_dispatches"] = [
        {"id": "cd-b", "owner_id": USER_B_ID, "status": "pending_confirm", "total_leads": 10},
    ]
    r = client.post("/api/chipcare-broadcast/dispatch", json={
        "dispatch_id": "cd-b",
        "assignments": [{"channel_id": 1, "planned_count": 10}],
        "template": {"template_name": "t", "template_id": "1", "language_code": "pt_BR"},
        "campaign_name": "test",
        "dry_run": True,
        "confirm_real_dispatch": False,
    })
    assert r.status_code == 404
