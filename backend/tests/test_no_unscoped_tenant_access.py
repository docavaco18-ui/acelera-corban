"""
Lint estático: nenhum arquivo fora do allowlist pode chamar
db.table("v8_leads") ou db.table("v8_bot_runs") direto.
Use scoped(db, "<table>", user_id).
"""
import ast
import pathlib

TENANT_TABLES = {
    "v8_leads", "v8_bot_runs", "v8_batches",
    "vctex_leads", "vctex_bot_runs", "vctex_batches",
}

ALLOWLIST = {
    "app/db_scoped.py",
    "app/routers/webhook.py",
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
