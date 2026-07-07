"""compute_dispatch_terminal — transição terminal de dispatch (deferido 8 do ultra review)."""
from app.services.broadcast.monitor_loop import compute_dispatch_terminal


def test_none_quando_sem_assignments():
    assert compute_dispatch_terminal([]) is None


def test_none_quando_assignment_ainda_rodando():
    asns = [{"planned_count": 100, "sent_count": 50, "failed_count": 0, "status": "running"}]
    assert compute_dispatch_terminal(asns) is None


def test_done_quando_todos_completos_por_contagem():
    asns = [{"planned_count": 100, "sent_count": 100, "failed_count": 0, "status": "running"}]
    assert compute_dispatch_terminal(asns) == "done"


def test_done_por_status_terminal():
    asns = [{"planned_count": 100, "sent_count": 90, "failed_count": 10, "status": "done"}]
    assert compute_dispatch_terminal(asns) == "done"


def test_error_quando_tudo_falhou():
    asns = [{"planned_count": 50, "sent_count": 0, "failed_count": 50, "status": "error"}]
    assert compute_dispatch_terminal(asns) == "error"


def test_partial_error_mistura_sucesso_e_erro():
    asns = [
        {"planned_count": 50, "sent_count": 50, "failed_count": 0, "status": "done"},
        {"planned_count": 50, "sent_count": 0, "failed_count": 50, "status": "error"},
    ]
    assert compute_dispatch_terminal(asns) == "partial_error"


def test_ignora_assignment_planned_zero():
    asns = [
        {"planned_count": 0, "sent_count": 0, "failed_count": 0, "status": "skipped"},
        {"planned_count": 10, "sent_count": 10, "failed_count": 0, "status": "done"},
    ]
    assert compute_dispatch_terminal(asns) == "done"


def test_aesir_schema_sent_errors_planned():
    """Aesir usa sent/errors/planned em vez de sent_count/failed_count/planned_count."""
    asns = [{"planned": 30, "sent": 30, "errors": 0, "status": "done"}]
    assert compute_dispatch_terminal(asns) == "done"


def test_um_vivo_bloqueia_terminal_mesmo_com_outro_pronto():
    asns = [
        {"planned_count": 20, "sent_count": 20, "failed_count": 0, "status": "done"},
        {"planned_count": 20, "sent_count": 5, "failed_count": 0, "status": "running"},
    ]
    assert compute_dispatch_terminal(asns) is None
