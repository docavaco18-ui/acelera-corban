"""Testes das correções anti-ban do intervention:

1. `_safe_pause` faz 1 retry e retorna False quando o provider não pausa
   (para o chamador escalar alerta em vez de fingir que pausou).
2. Trigger de falha total (sent=0, failed>=20) agora pausa o mailing — antes
   exigia sent>0 e nunca pausava um número/template 100% quebrado.
3. Falha ao pausar gera alerta crítico `pause_failed` (número RED não pode seguir
   disparando silenciosamente).
"""
from __future__ import annotations

import asyncio


class _Result:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, db, table):
        self._db, self._table = db, table
        self._op, self._payload = "select", None

    def select(self, *a, **k):
        self._op = "select"; return self

    def insert(self, payload):
        self._op, self._payload = "insert", payload; return self

    def update(self, payload):
        self._op, self._payload = "update", payload; return self

    def eq(self, *a, **k): return self
    def neq(self, *a, **k): return self
    def in_(self, *a, **k): return self
    def order(self, *a, **k): return self
    def limit(self, *a, **k): return self
    def single(self): return self

    @property
    def not_(self): return self

    def is_(self, *a, **k): return self

    def execute(self):
        if self._op == "select":
            return _Result(list(self._db.rows.get(self._table, [])))
        if self._op == "insert":
            self._db.inserts.setdefault(self._table, []).append(self._payload)
            row = dict(self._payload) if isinstance(self._payload, dict) else self._payload
            if isinstance(row, dict):
                row.setdefault("id", f"{self._table}-{len(self._db.inserts[self._table])}")
                return _Result([row])
            return _Result(row)
        if self._op == "update":
            self._db.updates.setdefault(self._table, []).append(self._payload)
            return _Result([self._payload])
        return _Result([])


class _DB:
    def __init__(self, rows):
        self.rows = rows
        self.inserts: dict = {}
        self.updates: dict = {}

    def table(self, name):
        return _Query(self, name)


class _FailingVendeAI:
    def __init__(self):
        self.calls = 0

    async def pause(self, mailing_id):
        self.calls += 1
        raise RuntimeError("provider down")


class _OkVendeAI:
    def __init__(self):
        self.calls = 0

    async def pause(self, mailing_id):
        self.calls += 1


def _run(coro):
    return asyncio.run(coro)


def test_safe_pause_returns_false_after_retry():
    from app.services.broadcast.intervention import _safe_pause
    v = _FailingVendeAI()
    assert _run(_safe_pause(v, "m1")) is False
    assert v.calls == 2  # tentativa + 1 retry


def test_safe_pause_true_on_success():
    from app.services.broadcast.intervention import _safe_pause
    v = _OkVendeAI()
    assert _run(_safe_pause(v, "m1")) is True
    assert v.calls == 1


def test_total_failure_zero_sent_pauses_mailing():
    from app.services.broadcast.intervention import evaluate_and_intervene
    db = _DB({
        "broadcast_dispatch_assignments": [{
            "id": "a1", "phone_id": "p1", "dispatch_id": "d1",
            "sent_count": 0, "failed_count": 25,
            "vendeai_mailing_id": "m1", "planned_count": 100,
            "broadcast_dispatches": {"owner_id": "o1", "status": "running"},
        }],
        "broadcast_numbers": [{"phone_id": "p1", "quality_rating": "GREEN", "is_paused": False}],
    })
    v = _OkVendeAI()
    _run(evaluate_and_intervene(db, "o1", v))
    alerts = db.inserts.get("broadcast_alerts", [])
    assert any(a.get("alert_type") == "failed_spike" for a in alerts)
    assert v.calls == 1  # mailing pausado
    assert {"status": "paused"} in db.updates.get("broadcast_dispatch_assignments", [])


def test_pause_failure_escalates_critical_alert():
    from app.services.broadcast.intervention import evaluate_and_intervene
    db = _DB({
        "broadcast_dispatch_assignments": [{
            "id": "a1", "phone_id": "p1", "dispatch_id": "d1",
            "sent_count": 0, "failed_count": 30,
            "vendeai_mailing_id": "m1", "planned_count": 100,
            "broadcast_dispatches": {"owner_id": "o1", "status": "running"},
        }],
        "broadcast_numbers": [{"phone_id": "p1", "quality_rating": "GREEN", "is_paused": False}],
    })
    v = _FailingVendeAI()
    _run(evaluate_and_intervene(db, "o1", v))
    alerts = db.inserts.get("broadcast_alerts", [])
    assert any(a.get("alert_type") == "pause_failed" and a.get("severity") == "critical" for a in alerts)
    assert v.calls == 2  # retry antes de escalar
