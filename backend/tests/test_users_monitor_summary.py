from __future__ import annotations


def _overview(score_status="ok", **over):
    base = {
        "generated_at": "2026-06-21T00:00:00+00:00",
        "score": {"score": 90, "status": score_status, "label": "ok"},
        "health": [
            {"id": "vendeai-meta", "group": "Meta/BM", "label": "Token Meta VendeAI",
             "status": "critical", "detail": "Token Meta ausente/corrompido"},
            {"id": "aesir-crm", "group": "Disparos", "label": "Credenciais Aesir",
             "status": "warning", "detail": "Credencial do CRM ausente/corrompida"},
            {"id": "vendeai-crm", "group": "Disparos", "label": "Credenciais VendeAI",
             "status": "ok", "detail": "CRM pronto"},
        ],
        "deliverability": {
            "totals": {"all": 3, "healthy": 1, "warning": 1, "critical": 1, "capacity_today": 500, "used_today": 0},
            "channels": [
                {"source": "vendeai", "quality_rating": "GREEN", "risk": "ok", "is_healthy": True, "remaining_today": 500, "has_payment_issue": False},
                {"source": "vendeai", "quality_rating": "YELLOW", "risk": "warning", "is_healthy": False, "remaining_today": 0, "has_payment_issue": False},
                {"source": "aesir", "quality_rating": "RED", "risk": "critical", "is_healthy": False, "remaining_today": 0, "has_payment_issue": True},
            ],
        },
        "capacity": {"capacity_today": 500},
        "meta_audits": [],
        "templates": {"by_status": {"APPROVED": 4}, "by_category": {}, "templates": []},
        "incidents": [
            {"severity": "critical", "title": "x", "detail": "y", "source": "z", "created_at": "t", "action": "a"},
        ],
    }
    base.update(over)
    return base


def test_build_pending_maps_health_issues():
    from app.routers.users_monitor_summary import build_pending
    pend = build_pending(_overview())
    labels = " | ".join(p["label"] for p in pend)
    assert "BM" in labels  # token Meta ausente vira pendência de BM
    assert any(p["severity"] == "critical" for p in pend)
    # check OK não vira pendência
    assert all("VendeAI" not in p["label"] or p["severity"] != "ok" for p in pend)


def test_summarize_overview_shape():
    from app.routers.users_monitor_summary import summarize_overview
    s = summarize_overview(
        _overview(), owner_id="o1", email="c@x.com",
        client_label="BM Teste", bms={"connected": 2, "error": 1, "total": 3},
    )
    assert s["owner_id"] == "o1"
    assert s["numbers"] == {"total": 3, "healthy": 1, "warning": 1, "critical": 1}
    assert s["capacity_today"] == 500
    assert s["quality"]["green"] == 1 and s["quality"]["red"] == 1
    assert s["bms"]["connected"] == 2
    assert s["templates"]["approved"] == 4
    assert isinstance(s["pending"], list) and len(s["pending"]) >= 1
    assert s["error"] is False


def test_summarize_overview_templates_null_in_cache():
    from app.routers.users_monitor_summary import summarize_overview
    ov = _overview()
    ov["meta_audits"] = []
    ov["templates"] = {"by_status": {}, "by_category": {}, "templates": []}
    s = summarize_overview(ov, owner_id="o", email=None, client_label="C",
                           bms={"connected": 0, "error": 0, "total": 0})
    assert s["templates"] is None


def test_build_aggregate_sums():
    from app.routers.users_monitor_summary import build_aggregate, summarize_overview
    a = summarize_overview(_overview("ok"), owner_id="a", email=None, client_label="A", bms={"connected": 1, "error": 0, "total": 1})
    b = summarize_overview(_overview("critical"), owner_id="b", email=None, client_label="B", bms={"connected": 0, "error": 2, "total": 2})
    agg = build_aggregate([a, b])
    assert agg["users_total"] == 2
    assert agg["users_critical"] == 1
    assert agg["users_healthy"] == 1
    assert agg["capacity_total"] == 1000
    assert agg["numbers_total"] == 6
    assert agg["bms_total"] == 3
