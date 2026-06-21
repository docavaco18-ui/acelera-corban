from __future__ import annotations

import asyncio


class _Q:
    """Query builder mock: select/eq/limit/order encadeáveis, execute() vazio."""
    def select(self, *_a, **_k): return self
    def eq(self, *_a, **_k): return self
    def limit(self, *_a, **_k): return self
    def order(self, *_a, **_k): return self
    def gte(self, *_a, **_k): return self
    def execute(self): return type("R", (), {"data": []})()


class _DB:
    def table(self, _name): return _Q()


def test_compute_overview_keys_on_empty_db():
    from app.routers.command_center import compute_overview
    out = asyncio.run(compute_overview(_DB(), "owner-x", live_meta=False))
    assert set(out) >= {
        "generated_at", "score", "health", "deliverability", "capacity",
        "meta_audits", "templates", "error_radar", "incidents", "checklist",
        "live_meta_requested", "live_meta_timed_out",
    }
    assert out["score"]["score"] <= 100 and out["score"]["score"] >= 0
    assert out["live_meta_requested"] is False
