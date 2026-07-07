"""Testes do validador server-side de assignments (VendeAI / Aesir / Chipcare).

Cobrem os P0 do Codex round 2:
- Tampering de planned_count acima do daily_limit
- phone_id/instance_id/channel_id que não pertence ao owner
- Pausado / DISABLED / quality RED
- Duplicidade
- Partial dispatch bloqueado por default
"""
from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.services.broadcast.assignment_validator import (
    validate_aesir_assignments,
    validate_chipcare_assignments,
    validate_vendeai_assignments,
)


# ── Mock DB ───────────────────────────────────────────────────────────────────

class MockTable:
    def __init__(self, data):
        self._data = data
        self._filters = {}

    def select(self, _):
        return self

    def eq(self, key, val):
        self._filters[key] = val
        return self

    def execute(self):
        # Mock returns rows matching owner_id filter
        if "owner_id" in self._filters:
            return type("R", (), {"data": [r for r in self._data if r.get("owner_id") == self._filters["owner_id"]]})()
        return type("R", (), {"data": self._data})()


class MockDB:
    def __init__(self, tables: dict):
        self._tables = tables

    def table(self, name):
        return MockTable(self._tables.get(name, []))


# ── VendeAI tests ─────────────────────────────────────────────────────────────

def _vendeai_db(numbers):
    return MockDB({"broadcast_numbers": numbers})


def test_vendeai_happy_path():
    db = _vendeai_db([
        {"owner_id": "u1", "phone_id": "p1", "daily_limit": 500, "is_paused": False, "can_send": "AVAILABLE"},
        {"owner_id": "u1", "phone_id": "p2", "daily_limit": 300, "is_paused": False, "can_send": "AVAILABLE"},
    ])
    assignments = [
        {"phone_id": "p1", "planned_count": 200, "inbox_id": "1", "template_id": "t1"},
        {"phone_id": "p2", "planned_count": 100, "inbox_id": "2", "template_id": "t1"},
    ]
    assigned, unassigned = validate_vendeai_assignments(db, "u1", assignments, 300)
    assert assigned == 300
    assert unassigned == 0


def test_vendeai_rejects_phone_id_from_another_owner():
    db = _vendeai_db([{"owner_id": "u1", "phone_id": "p1", "daily_limit": 500, "is_paused": False, "can_send": "AVAILABLE"}])
    assignments = [{"phone_id": "p_alheio", "planned_count": 100, "inbox_id": "1", "template_id": "t1"}]
    with pytest.raises(HTTPException) as exc:
        validate_vendeai_assignments(db, "u1", assignments, 100)
    assert exc.value.status_code == 404
    assert "não pertence" in exc.value.detail


def test_vendeai_rejects_planned_above_daily_limit():
    db = _vendeai_db([{"owner_id": "u1", "phone_id": "p1", "daily_limit": 500, "is_paused": False, "can_send": "AVAILABLE"}])
    assignments = [{"phone_id": "p1", "planned_count": 999999, "inbox_id": "1", "template_id": "t1"}]
    with pytest.raises(HTTPException) as exc:
        validate_vendeai_assignments(db, "u1", assignments, 999999)
    assert exc.value.status_code == 400
    assert "excede o limite diário restante" in exc.value.detail


def test_vendeai_rejects_paused_phone():
    db = _vendeai_db([{"owner_id": "u1", "phone_id": "p1", "daily_limit": 500, "is_paused": True, "can_send": "AVAILABLE"}])
    assignments = [{"phone_id": "p1", "planned_count": 100, "inbox_id": "1", "template_id": "t1"}]
    with pytest.raises(HTTPException) as exc:
        validate_vendeai_assignments(db, "u1", assignments, 100)
    assert "pausado" in exc.value.detail


def test_vendeai_rejects_disabled_can_send():
    db = _vendeai_db([{"owner_id": "u1", "phone_id": "p1", "daily_limit": 500, "is_paused": False, "can_send": "DISABLED"}])
    assignments = [{"phone_id": "p1", "planned_count": 100, "inbox_id": "1", "template_id": "t1"}]
    with pytest.raises(HTTPException) as exc:
        validate_vendeai_assignments(db, "u1", assignments, 100)
    assert "DISABLED" in exc.value.detail


def test_vendeai_rejects_duplicate_phone_id():
    db = _vendeai_db([{"owner_id": "u1", "phone_id": "p1", "daily_limit": 500, "is_paused": False, "can_send": "AVAILABLE"}])
    assignments = [
        {"phone_id": "p1", "planned_count": 100, "inbox_id": "1", "template_id": "t1"},
        {"phone_id": "p1", "planned_count": 50, "inbox_id": "1", "template_id": "t1"},
    ]
    with pytest.raises(HTTPException) as exc:
        validate_vendeai_assignments(db, "u1", assignments, 150)
    assert exc.value.status_code == 409


def test_vendeai_blocks_partial_dispatch_by_default():
    db = _vendeai_db([{"owner_id": "u1", "phone_id": "p1", "daily_limit": 500, "is_paused": False, "can_send": "AVAILABLE"}])
    assignments = [{"phone_id": "p1", "planned_count": 100, "inbox_id": "1", "template_id": "t1"}]
    with pytest.raises(HTTPException) as exc:
        validate_vendeai_assignments(db, "u1", assignments, 1000)  # 100 atribuídos de 1000 total
    assert "parcial bloqueada" in exc.value.detail


def test_vendeai_allows_partial_with_explicit_flag():
    db = _vendeai_db([{"owner_id": "u1", "phone_id": "p1", "daily_limit": 500, "is_paused": False, "can_send": "AVAILABLE"}])
    assignments = [{"phone_id": "p1", "planned_count": 100, "inbox_id": "1", "template_id": "t1"}]
    assigned, unassigned = validate_vendeai_assignments(db, "u1", assignments, 1000, allow_partial=True)
    assert assigned == 100
    assert unassigned == 900


def test_vendeai_rejects_sum_above_total():
    db = _vendeai_db([{"owner_id": "u1", "phone_id": "p1", "daily_limit": 500, "is_paused": False, "can_send": "AVAILABLE"}])
    assignments = [{"phone_id": "p1", "planned_count": 200, "inbox_id": "1", "template_id": "t1"}]
    with pytest.raises(HTTPException) as exc:
        validate_vendeai_assignments(db, "u1", assignments, 100, allow_partial=True)
    assert "maior que total_leads" in exc.value.detail


def test_vendeai_skips_zero_planned_no_validation():
    db = _vendeai_db([
        {"owner_id": "u1", "phone_id": "p1", "daily_limit": 500, "is_paused": False, "can_send": "AVAILABLE"},
        {"owner_id": "u1", "phone_id": "p2", "daily_limit": 300, "is_paused": False, "can_send": "AVAILABLE"},
    ])
    # p2 com planned=0 e sem inbox/template — deve ser ignorada (não falhar)
    assignments = [
        {"phone_id": "p1", "planned_count": 100, "inbox_id": "1", "template_id": "t1"},
        {"phone_id": "p2", "planned_count": 0},
    ]
    assigned, _ = validate_vendeai_assignments(db, "u1", assignments, 100)
    assert assigned == 100


def test_vendeai_requires_inbox_template_when_planned_positive():
    db = _vendeai_db([{"owner_id": "u1", "phone_id": "p1", "daily_limit": 500, "is_paused": False, "can_send": "AVAILABLE"}])
    assignments = [{"phone_id": "p1", "planned_count": 100}]
    with pytest.raises(HTTPException) as exc:
        validate_vendeai_assignments(db, "u1", assignments, 100)
    assert "inbox_id e template_id" in exc.value.detail


# ── Aesir tests ───────────────────────────────────────────────────────────────

class _AsnDC:
    """Mimic AssignmentIn pydantic for tests."""
    def __init__(self, instance_id, planned_count):
        self.instance_id = instance_id
        self.planned_count = planned_count


def _aesir_db(instances):
    return MockDB({"aesir_instances": instances})


def test_aesir_rejects_meta_only_instance():
    db = _aesir_db([
        {"owner_id": "u1", "instance_id": "i1", "daily_limit": 500, "is_paused": False, "can_send": "AVAILABLE", "status": "meta-only", "quality_rating": "GREEN"},
    ])
    assignments = [_AsnDC("i1", 100)]
    with pytest.raises(HTTPException) as exc:
        validate_aesir_assignments(db, "u1", assignments, 100)
    assert "meta-only" in exc.value.detail


def test_aesir_rejects_red_quality():
    db = _aesir_db([
        {"owner_id": "u1", "instance_id": "i1", "daily_limit": 500, "is_paused": False, "can_send": "AVAILABLE", "status": "active", "quality_rating": "RED"},
    ])
    with pytest.raises(HTTPException) as exc:
        validate_aesir_assignments(db, "u1", [_AsnDC("i1", 100)], 100)
    assert "RED" in exc.value.detail


def test_aesir_blocks_partial_by_default():
    db = _aesir_db([
        {"owner_id": "u1", "instance_id": "i1", "daily_limit": 500, "is_paused": False, "can_send": "AVAILABLE", "status": "active", "quality_rating": "GREEN"},
    ])
    with pytest.raises(HTTPException) as exc:
        validate_aesir_assignments(db, "u1", [_AsnDC("i1", 100)], 500)
    assert "parcial bloqueada" in exc.value.detail


# ── Chipcare tests ────────────────────────────────────────────────────────────

class _ChipAsnDC:
    def __init__(self, channel_id, planned_count):
        self.channel_id = channel_id
        self.planned_count = planned_count


def _chipcare_db(channels):
    return MockDB({"chipcare_channels": channels})


def test_chipcare_rejects_negative_channel_id_meta_only():
    db = _chipcare_db([
        {"owner_id": "u1", "channel_id": -1, "daily_limit": 500, "is_paused": False, "status": "meta-only"},
    ])
    with pytest.raises(HTTPException) as exc:
        validate_chipcare_assignments(db, "u1", [_ChipAsnDC(-1, 100)], 100)
    assert "meta-only" in exc.value.detail


def test_chipcare_rejects_offline_channel():
    db = _chipcare_db([
        {"owner_id": "u1", "channel_id": 5, "daily_limit": 500, "is_paused": False, "status": "OFFLINE"},
    ])
    with pytest.raises(HTTPException) as exc:
        validate_chipcare_assignments(db, "u1", [_ChipAsnDC(5, 100)], 100)
    assert "não conectado" in exc.value.detail


def test_chipcare_happy_path_full_dispatch():
    db = _chipcare_db([
        {"owner_id": "u1", "channel_id": 5, "daily_limit": 500, "is_paused": False, "status": "CONNECTED"},
        {"owner_id": "u1", "channel_id": 6, "daily_limit": 500, "is_paused": False, "status": "ONLINE"},
    ])
    assigned, unassigned = validate_chipcare_assignments(db, "u1", [_ChipAsnDC(5, 100), _ChipAsnDC(6, 50)], 150)
    assert assigned == 150
    assert unassigned == 0


def test_chipcare_duplicate_channel_id_rejected():
    db = _chipcare_db([
        {"owner_id": "u1", "channel_id": 5, "daily_limit": 500, "is_paused": False, "status": "CONNECTED"},
    ])
    with pytest.raises(HTTPException) as exc:
        validate_chipcare_assignments(db, "u1", [_ChipAsnDC(5, 50), _ChipAsnDC(5, 30)], 80)
    assert exc.value.status_code == 409


def test_negative_planned_count_rejected():
    db = _vendeai_db([{"owner_id": "u1", "phone_id": "p1", "daily_limit": 500, "is_paused": False, "can_send": "AVAILABLE"}])
    with pytest.raises(HTTPException) as exc:
        validate_vendeai_assignments(db, "u1", [{"phone_id": "p1", "planned_count": -5, "inbox_id": "1", "template_id": "t1"}], 0)
    assert "negativo" in exc.value.detail


# ── Capacidade: tier não reportado + desconto de sent_today (ultra review 06/07)

class MockTableGte(MockTable):
    def gte(self, key, val):
        return self


class MockDBGte(MockDB):
    def table(self, name):
        return MockTableGte(self._tables.get(name, []))


def test_vendeai_rejects_zero_daily_limit_sem_tier():
    """Tier não reportado (daily_limit 0) NÃO vira 500 fabricado — bloqueia com 400."""
    db = MockDBGte({"broadcast_numbers": [
        {"owner_id": "u1", "phone_id": "p1", "daily_limit": 0, "is_paused": False, "can_send": "AVAILABLE"},
    ]})
    assignments = [{"phone_id": "p1", "planned_count": 10, "inbox_id": "1", "template_id": "t1"}]
    with pytest.raises(HTTPException) as exc:
        validate_vendeai_assignments(db, "u1", assignments, 10)
    assert exc.value.status_code == 400
    assert "sem capacidade" in exc.value.detail


def test_vendeai_desconta_sent_today():
    """2º disparo do dia só pode planejar o limite RESTANTE (limit - sent hoje)."""
    db = MockDBGte({
        "broadcast_numbers": [
            {"owner_id": "u1", "phone_id": "p1", "daily_limit": 100, "is_paused": False, "can_send": "AVAILABLE"},
        ],
        "broadcast_dispatch_assignments": [
            {"owner_id": "u1", "phone_id": "p1", "sent_count": 80},
        ],
    })
    ok = [{"phone_id": "p1", "planned_count": 20, "inbox_id": "1", "template_id": "t1"}]
    validate_vendeai_assignments(db, "u1", ok, 20)  # 20 cabe no restante (100-80)
    too_much = [{"phone_id": "p1", "planned_count": 21, "inbox_id": "1", "template_id": "t1"}]
    with pytest.raises(HTTPException) as exc:
        validate_vendeai_assignments(db, "u1", too_much, 21)
    assert exc.value.status_code == 400
    assert "já enviadas hoje" in exc.value.detail


def test_vendeai_rejects_quality_red():
    db = MockDBGte({"broadcast_numbers": [
        {"owner_id": "u1", "phone_id": "p1", "daily_limit": 100, "is_paused": False,
         "can_send": "AVAILABLE", "quality_rating": "RED"},
    ]})
    assignments = [{"phone_id": "p1", "planned_count": 10, "inbox_id": "1", "template_id": "t1"}]
    with pytest.raises(HTTPException) as exc:
        validate_vendeai_assignments(db, "u1", assignments, 10)
    assert "RED" in exc.value.detail


def test_aesir_desconta_sent_today_do_assignments_json():
    db = MockDBGte({
        "aesir_instances": [
            {"owner_id": "u1", "instance_id": "i1", "daily_limit": 100, "is_paused": False,
             "can_send": "AVAILABLE", "quality_rating": "GREEN", "status": "connected"},
        ],
        "aesir_dispatches": [
            {"owner_id": "u1", "assignments_json": [{"instance_id": "i1", "sent": 90}]},
        ],
    })
    with pytest.raises(HTTPException) as exc:
        validate_aesir_assignments(db, "u1", [{"instance_id": "i1", "planned_count": 11}], 11)
    assert "já enviadas hoje" in exc.value.detail


def test_chipcare_rejects_quality_red():
    db = MockDBGte({"chipcare_channels": [
        {"owner_id": "u1", "channel_id": 7, "daily_limit": 100, "is_paused": False,
         "status": "CONNECTED", "quality_rating": "RED"},
    ]})
    with pytest.raises(HTTPException) as exc:
        validate_chipcare_assignments(db, "u1", [{"channel_id": 7, "planned_count": 5}], 5)
    assert "RED" in exc.value.detail
