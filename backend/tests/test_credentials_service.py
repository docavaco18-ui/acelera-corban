import pytest
from unittest.mock import MagicMock
from uuid import uuid4

from app.credentials.service import CredentialService, BankCredentials


@pytest.fixture
def fake_db():
    db = MagicMock()
    db._rows = {}

    def _table(name):
        assert name == "user_bank_credentials"
        return _Q(db)
    db.table = _table
    return db


class _Q:
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
    user_id = str(uuid4())
    svc = CredentialService(fake_db)
    svc.upsert(user_id, "v8", login="x", password="y")
    fake_db._rows[(user_id, "v8")]["proxies_enc"] = None
    creds = svc.get(user_id, "v8")
    assert creds.proxies == []
