"""
A/B tenant isolation tests for broadcast tables.
User A must NEVER see User B's numbers, dispatches, alerts, or recipients.
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
        self._order_col: str | None = None
        self._order_desc: bool = False
        self._limit_n: int | None = None
        self._single_mode: bool = False

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
    def eq(self, c, v): self._filters.append(("eq", c, v)); return self
    def neq(self, c, v): return self
    def in_(self, c, v): self._filters.append(("in_", c, v)); return self
    def not_(self): return self
    def order(self, col, desc=False): self._order_col = col; self._order_desc = desc; return self
    def limit(self, n): self._limit_n = n; return self
    def range(self, lo, hi): return self
    def single(self): self._single_mode = True; return self
    def maybe_single(self): return self

    def _match(self, row) -> bool:
        for op, c, v in self._filters:
            rv = row.get(c)
            if op == "eq" and rv != v: return False
            if op == "in_" and rv not in v: return False
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
        if self._order_col:
            match = sorted(match, key=lambda r: r.get(self._order_col, ""), reverse=self._order_desc)
        if self._limit_n is not None:
            match = match[:self._limit_n]
        if self._action == "select":
            if self._single_mode:
                return MagicMock(data=match[0] if match else None)
            return MagicMock(data=match)
        if self._action == "update":
            for r in match: r.update(self._payload)
            return MagicMock(data=match)
        if self._action == "delete":
            for r in match: rows.remove(r)
            return MagicMock(data=match)
        raise NotImplementedError(self._action)


@pytest.fixture
def fake_db():
    return FakeDB()


@pytest.fixture
def client_as(fake_db, monkeypatch):
    import app.routers.broadcast as broadcast_mod

    monkeypatch.setattr(broadcast_mod, "get_db", lambda: fake_db)

    def _make(user_id: str):
        # Override the HTTPBearer-based _get_user_id dependency directly
        app.dependency_overrides[broadcast_mod._get_user_id] = lambda: user_id
        return TestClient(app, raise_server_exceptions=True)

    yield _make
    app.dependency_overrides.clear()


# ── broadcast_numbers ────────────────────────────────────────────────────────

def test_numbers_isolated(client_as, fake_db):
    fake_db.rows["broadcast_numbers"] = [
        {"id": "n1", "phone_id": "111", "owner_id": USER_A_ID},
        {"id": "n2", "phone_id": "222", "owner_id": USER_B_ID},
    ]
    nums_a = client_as(USER_A_ID).get("/api/broadcast/numbers").json()
    nums_b = client_as(USER_B_ID).get("/api/broadcast/numbers").json()

    assert all(n["owner_id"] == USER_A_ID for n in nums_a)
    assert all(n["owner_id"] == USER_B_ID for n in nums_b)
    assert {n["phone_id"] for n in nums_a} == {"111"}
    assert {n["phone_id"] for n in nums_b} == {"222"}


# ── broadcast_dispatches ────────────────────────────────────────────────────

def test_dispatches_isolated(client_as, fake_db):
    fake_db.rows["broadcast_dispatches"] = [
        {"id": "d1", "status": "pending_confirm", "owner_id": USER_A_ID, "created_at": "2026-01-01"},
        {"id": "d2", "status": "pending_confirm", "owner_id": USER_B_ID, "created_at": "2026-01-01"},
    ]
    fake_db.rows["broadcast_dispatch_assignments"] = []
    disps_a = client_as(USER_A_ID).get("/api/broadcast/dispatches").json()
    disps_b = client_as(USER_B_ID).get("/api/broadcast/dispatches").json()

    assert all(d["owner_id"] == USER_A_ID for d in disps_a)
    assert all(d["owner_id"] == USER_B_ID for d in disps_b)
    assert {d["id"] for d in disps_a} == {"d1"}
    assert {d["id"] for d in disps_b} == {"d2"}


def test_dispatch_get_by_id_cross_tenant_blocked(client_as, fake_db):
    """User A trying to fetch dispatch owned by B must get 404."""
    fake_db.rows["broadcast_dispatches"] = [
        {"id": "d-b", "status": "running", "owner_id": USER_B_ID, "created_at": "2026-01-01"},
    ]
    fake_db.rows["broadcast_dispatch_assignments"] = []
    r = client_as(USER_A_ID).get("/api/broadcast/dispatches/d-b")
    assert r.status_code == 404


# ── broadcast_alerts ────────────────────────────────────────────────────────

def test_alerts_isolated(client_as, fake_db):
    fake_db.rows["broadcast_alerts"] = [
        {"id": "al1", "msg": "A-alert", "owner_id": USER_A_ID, "ts": "2026-01-01"},
        {"id": "al2", "msg": "B-alert", "owner_id": USER_B_ID, "ts": "2026-01-01"},
    ]
    alerts_a = client_as(USER_A_ID).get("/api/broadcast/alerts").json()
    alerts_b = client_as(USER_B_ID).get("/api/broadcast/alerts").json()

    assert all(a["owner_id"] == USER_A_ID for a in alerts_a)
    assert all(a["owner_id"] == USER_B_ID for a in alerts_b)
    assert {a["msg"] for a in alerts_a} == {"A-alert"}
    assert {a["msg"] for a in alerts_b} == {"B-alert"}
