"""Regression: MAX_ROWS precisa existir em todo router que pagina com ele.

Bug histórico (audit Codex 2026-06-09): mercantil.py e vctex.py usavam
`while offset < MAX_ROWS` sem definir a constante — NameError → 500 em
/stats/dashboard e /batches/{id}/stats para usuário autenticado.
Os testes de suite não pegavam porque nenhum exercitava esses endpoints.
"""
import ast
from pathlib import Path

import pytest

ROUTERS_DIR = Path(__file__).resolve().parents[1] / "app" / "routers"


def test_max_rows_defined_in_mercantil():
    from app.routers import mercantil
    assert isinstance(mercantil.MAX_ROWS, int) and mercantil.MAX_ROWS > 0


def test_max_rows_defined_in_vctex():
    from app.routers import vctex
    assert isinstance(vctex.MAX_ROWS, int) and vctex.MAX_ROWS > 0


@pytest.mark.parametrize("router_file", sorted(ROUTERS_DIR.glob("*.py")))
def test_no_undefined_module_constants(router_file: Path):
    """AST: todo Name UPPER_CASE usado num router deve estar definido no módulo,
    importado, ou ser builtin. Pega a classe inteira de bug copy-paste-sem-constante."""
    tree = ast.parse(router_file.read_text(encoding="utf-8"))

    defined: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign):
            for t in node.targets:
                if isinstance(t, ast.Name):
                    defined.add(t.id)
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            defined.add(node.target.id)
        elif isinstance(node, (ast.Import, ast.ImportFrom)):
            for alias in node.names:
                defined.add((alias.asname or alias.name).split(".")[0])
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            defined.add(node.name)

    used_constants = {
        node.id
        for node in ast.walk(tree)
        if isinstance(node, ast.Name)
        and isinstance(node.ctx, ast.Load)
        and node.id.isupper()
        and len(node.id) > 1
    }

    builtins_upper = {"True", "False", "None"}
    missing = used_constants - defined - builtins_upper
    assert not missing, (
        f"{router_file.name}: constantes usadas mas não definidas/importadas: {missing}"
    )
