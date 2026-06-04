import pytest
from fastapi.testclient import TestClient
from unittest.mock import MagicMock

from app.main import app
from app.auth_deps import require_user, AuthUser
from app.credentials.service import CredentialService, BankCredentials
from app.credentials.router import get_credential_service


@pytest.fixture
def fake_user():
    return AuthUser(
        user_id="11111111-1111-1111-1111-111111111111",
        email="u@test",
        is_admin=False,
        raw={},
    )


@pytest.fixture
def client(fake_user):
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
    assert body == {"v8": None, "vctex": None, "mercantil": None, "presenca": None, "powerhub": None}


def test_get_returns_safe_summary(client):
    client.fake_svc.get.side_effect = lambda uid, bank: (
        BankCredentials(user_id=uid, bank_code=bank, login="alice", password="s3cret",
                        proxies=["http://p1", "http://p2"])
        if bank == "v8" else None
    )
    resp = client.get("/api/credentials")
    assert resp.status_code == 200
    body = resp.json()
    assert body["v8"] == {"configured": True, "login": "alice", "has_password": True, "proxies": ["http://p1", "http://p2"]}
    assert body["vctex"] is None
    assert "s3cret" not in resp.text


def test_put_creates_credentials(client):
    payload = {"login": "alice", "password": "s3cret", "proxies": ["http://p1"]}
    resp = client.put("/api/credentials/v8", json=payload)
    assert resp.status_code == 204
    client.fake_svc.upsert.assert_called_once()
    _, kwargs = client.fake_svc.upsert.call_args
    assert kwargs["bank_code"] == "v8"
    assert kwargs["login"] == "alice"
    assert kwargs["password"] == "s3cret"
    assert kwargs["proxies"] == ["http://p1"]


def test_put_rejects_invalid_bank(client):
    resp = client.put("/api/credentials/banco_x", json={"login": "a", "password": "b"})
    assert resp.status_code in (400, 422)


def test_put_proxies_optional(client):
    resp = client.put("/api/credentials/vctex", json={"login": "bob", "password": "pw"})
    assert resp.status_code == 204
    _, kwargs = client.fake_svc.upsert.call_args
    assert kwargs["proxies"] == []
