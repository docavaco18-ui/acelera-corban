from unittest.mock import MagicMock
from fastapi.testclient import TestClient
from app.main import app


def test_webhook_resolves_owner_and_updates_by_id(monkeypatch):
    db = MagicMock()
    resolve = MagicMock()
    resolve.data = {"id": "row-1", "owner_id": "u-A"}
    db.table.return_value.select.return_value.eq.return_value.maybe_single.return_value.execute.return_value = resolve

    captured: dict = {}
    from app.routers import webhook as webhook_mod

    class FakeScoped:
        def __init__(self, q, uid):
            self.uid = uid
        def update(self, u):
            captured["u"] = u
            captured["uid"] = self.uid
            return self
        def eq(self, c, v):
            captured[c] = v
            return self
        def execute(self):
            return MagicMock(data=[])

    monkeypatch.setattr(webhook_mod, "_verify_v8_signature", lambda raw, sig: None)
    monkeypatch.setattr(webhook_mod, "scoped", lambda d, t, uid: FakeScoped(None, uid))
    monkeypatch.setattr(webhook_mod, "get_db", lambda: db)

    with TestClient(app) as c:
        r = c.post("/api/webhook/v8", json={"consult_id": "x", "status": "REJECTED", "description": "rejected"})
    assert r.status_code == 200
    assert r.json()["matched"] is True
    assert captured["uid"] == "u-A"
    assert captured["id"] == "row-1"
