"""
Lint estático: nenhum arquivo fora do allowlist pode chamar
db.table("v8_leads") ou db.table("v8_bot_runs") direto.
Use scoped(db, "<table>", user_id).
"""
import ast
import pathlib

TENANT_TABLES = {
    # Higienização
    "v8_leads", "v8_bot_runs", "v8_batches",
    "vctex_leads", "vctex_bot_runs", "vctex_batches",
    "mercantil_leads", "mercantil_bot_runs", "mercantil_batches",
    "presenca_leads", "presenca_bot_runs", "presenca_batches",
    "powerhub_leads", "powerhub_bot_runs", "powerhub_batches",
    # CRM
    "crm_propostas", "crm_settings",
    # Disparo WhatsApp (VendeAI / Aesir / Chipcare)
    "vendeai_settings",
    "broadcast_numbers", "broadcast_dispatches", "broadcast_dispatch_assignments",
    "broadcast_alerts", "broadcast_recipients",
    "aesir_instances", "aesir_dispatches",
    "chipcare_channels", "chipcare_dispatches", "chipcare_settings",
}

ALLOWLIST = {
    "app/db_scoped.py",
    "app/routers/webhook.py",
    "app/routers/admin.py",             # cross-tenant intencional — protegido por require_admin
    "app/routers/chatwoot.py",          # filtra .eq("owner_id") manualmente antes de range/in_
    "app/services/chatwoot_service.py", # filtra .eq("owner_id") manualmente no loop de paginação
    # Módulos de disparo: todos filtram .eq("owner_id", user_id) manualmente
    "app/routers/broadcast.py",
    "app/routers/aesir_broadcast.py",
    "app/routers/chipcare_broadcast.py",
    "app/services/broadcast/monitor_loop.py",
    "app/services/broadcast/intervention.py",
    "app/routers/command_center.py",
    # Serviços de banco: filtram owner_id corretamente mas não via scoped()
    "app/services/mercantil_bot_service.py",
    "app/services/presenca_scheduler_loop.py",  # cross-tenant intencional — scheduler
    "app/main.py",  # startup sweep: cross-tenant intencional — recupera dispatches órfãos após restart
}

ROOT = pathlib.Path(__file__).resolve().parents[1] / "app"


def _scan(py: pathlib.Path) -> list[str]:
    offenders: list[str] = []
    tree = ast.parse(py.read_text())
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        if not isinstance(node.func, ast.Attribute) or node.func.attr != "table":
            continue
        if not node.args:
            continue
        arg = node.args[0]
        if isinstance(arg, ast.Constant) and arg.value in TENANT_TABLES:
            offenders.append(f"{py}:{node.lineno} db.table({arg.value!r})")
    return offenders


def test_no_unscoped_tenant_table_access():
    offenders: list[str] = []
    for py in ROOT.rglob("*.py"):
        rel = "app/" + str(py.relative_to(ROOT)).replace("\\", "/")
        if rel in ALLOWLIST:
            continue
        offenders.extend(_scan(py))
    assert not offenders, (
        "Use scoped(db, '<table>', user_id) em vez de db.table() pra tabelas tenant:\n"
        + "\n".join(offenders)
    )
