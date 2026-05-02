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
    assert h.num_workers == 3


@pytest.mark.asyncio
async def test_global_cap_503(fake_creds, fake_db, monkeypatch):
    pool = V8BotPool()
    monkeypatch.setattr(pool, "_spawn_workers", AsyncMock(return_value=None))
    monkeypatch.setattr(pool, "_persist_run", AsyncMock(return_value="run-1"))
    await pool.start("u1", 3, fake_creds, fake_db)
    await pool.start("u2", 2, fake_creds, fake_db)
    with pytest.raises(HTTPException) as ei:
        await pool.start("u3", 1, fake_creds, fake_db)
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
