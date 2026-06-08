"""
CSV lead count tests.
Unit tests validate the counting logic directly.
Integration tests hit /api/broadcast/analyze with mocked AI + Redis.
"""
import io
import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi.testclient import TestClient
from app.main import app


# ── Unit tests (logic only) ──────────────────────────────────────────────────

def _count_leads(raw: bytes) -> int:
    """Mirrors the logic in broadcast.py:285-286."""
    if raw.startswith(b"\xef\xbb\xbf"):
        raw = raw[3:]
    lines = [l for l in raw.decode("utf-8", errors="replace").splitlines() if l.strip()]
    return max(0, len(lines) - 1)


def test_header_plus_one_lead_no_trailing_newline():
    assert _count_leads(b"cpf,nome\n12345678901,Joao") == 1


def test_header_plus_one_lead_with_trailing_newline():
    assert _count_leads(b"cpf,nome\n12345678901,Joao\n") == 1


def test_header_only_returns_zero():
    assert _count_leads(b"cpf,nome\n") == 0


def test_bom_utf8_stripped_before_count():
    assert _count_leads(b"\xef\xbb\xbfcpf,nome\n12345678901,Ana\n98765432100,Pedro\n") == 2


def test_empty_lines_ignored():
    assert _count_leads(b"cpf,nome\n\n12345678901,Joao\n\n98765432100,Maria\n\n") == 2


def test_empty_csv_returns_zero():
    assert _count_leads(b"") == 0


def test_only_whitespace_lines_returns_zero():
    assert _count_leads(b"   \n\t\n") == 0


# ── Integration tests (real endpoint with mocked AI + Redis) ─────────────────

USER_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc"

FAKE_NUMBER = {
    "phone_id": "551100000001",
    "quality_rating": "GREEN",
    "messaging_tier": "STANDARD",
    "daily_limit": 1000,
    "is_paused": False,
    "can_send": "YES",
    "chatwoot_connected": False,
    "display_phone": "+55 11 0000-0001",
    "chatwoot_inbox_id": None,
    "waba_id": "waba123",
    "owner_id": USER_ID,
}

FAKE_SPLIT = {
    "assignments": [{"phone_id": "551100000001", "planned_count": 1}],
    "explanation": "ok",
}


def _make_analyze_client(monkeypatch):
    import app.routers.broadcast as bmod
    fake_db = MagicMock()
    fake_db.table.return_value.select.return_value.eq.return_value.execute.return_value = MagicMock(
        data=[FAKE_NUMBER]
    )
    fake_db.table.return_value.insert.return_value.execute.return_value = MagicMock(data=[])

    monkeypatch.setattr(bmod, "get_db", lambda: fake_db)
    monkeypatch.setattr(bmod, "advise_split", AsyncMock(return_value=FAKE_SPLIT))
    app.dependency_overrides[bmod._get_user_id] = lambda: USER_ID

    # Patch Redis so no real connection is needed
    mock_redis = AsyncMock()
    mock_redis.__aenter__ = AsyncMock(return_value=mock_redis)
    mock_redis.__aexit__ = AsyncMock(return_value=False)
    mock_redis.setex = AsyncMock()
    monkeypatch.setattr(bmod.aioredis, "from_url", lambda *a, **k: mock_redis)

    return TestClient(app, raise_server_exceptions=True)


@pytest.fixture(autouse=False)
def clear_overrides():
    yield
    app.dependency_overrides.clear()


def test_analyze_endpoint_counts_one_lead(monkeypatch, clear_overrides):
    client = _make_analyze_client(monkeypatch)
    csv = b"cpf,nome\n12345678901,Joao"
    r = client.post("/api/broadcast/analyze", files={"file": ("test.csv", io.BytesIO(csv), "text/csv")})
    assert r.status_code == 200
    assert r.json()["total_leads"] == 1


def test_analyze_endpoint_bom_stripped(monkeypatch, clear_overrides):
    client = _make_analyze_client(monkeypatch)
    csv = b"\xef\xbb\xbfcpf,nome\n12345678901,Ana\n98765432100,Pedro\n"
    r = client.post("/api/broadcast/analyze", files={"file": ("test.csv", io.BytesIO(csv), "text/csv")})
    assert r.status_code == 200
    assert r.json()["total_leads"] == 2


def test_analyze_endpoint_empty_lines_ignored(monkeypatch, clear_overrides):
    client = _make_analyze_client(monkeypatch)
    csv = b"cpf,nome\n\n12345678901,Joao\n\n98765432100,Maria\n\n"
    r = client.post("/api/broadcast/analyze", files={"file": ("test.csv", io.BytesIO(csv), "text/csv")})
    assert r.status_code == 200
    assert r.json()["total_leads"] == 2


def test_analyze_endpoint_no_trailing_newline(monkeypatch, clear_overrides):
    client = _make_analyze_client(monkeypatch)
    csv = b"cpf\n11111111111\n22222222222\n33333333333"
    r = client.post("/api/broadcast/analyze", files={"file": ("test.csv", io.BytesIO(csv), "text/csv")})
    assert r.status_code == 200
    assert r.json()["total_leads"] == 3
