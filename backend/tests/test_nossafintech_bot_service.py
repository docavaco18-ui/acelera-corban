import pytest

from app.services import nossafintech_bot_service


@pytest.mark.asyncio
async def test_fetch_pending_does_not_fallback_outside_requested_batch(monkeypatch):
    class FakeExecute:
        data = []

    class FakeQuery:
        def select(self, *_):
            return self

        def in_(self, *_):
            return self

        def eq(self, *_):
            return self

        def limit(self, *_):
            return self

        def execute(self):
            return FakeExecute()

    class FakeScoped:
        def select(self, *_):
            return FakeQuery()

    calls = []

    def fake_scoped(db, table, user_id):
        calls.append((table, user_id))
        return FakeScoped()

    monkeypatch.setattr(nossafintech_bot_service, "scoped", fake_scoped)

    rows = await nossafintech_bot_service._fetch_pending(
        db=object(),
        user_id="user-1",
        limit=50,
        batch_id="batch-empty",
    )

    assert rows == []
    assert calls == [("nossafintech_leads", "user-1")]
