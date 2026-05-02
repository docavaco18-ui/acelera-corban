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
    fetch.assert_awaited_once()


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
    auth_mod._token_cache["u1"] = ("tok-A", time.time() - 1)
    b = await auth_mod.get_token("u1", "alice", "pw")
    assert b == "tok-B"
    assert fetch.await_count == 2
