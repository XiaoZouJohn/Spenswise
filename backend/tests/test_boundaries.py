"""Executable import boundaries for collaborative work."""

import ast
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT.parent / "frontend" / "src" / "pages"


def test_routes_and_tasks_do_not_import_calculation_libraries():
    for name in ("main.py", "tasks.py"):
        tree = ast.parse((ROOT / "app" / name).read_text(encoding="utf-8"))
        imports = [node.module or "" for node in ast.walk(tree) if isinstance(node, ast.ImportFrom)]
        imports.extend(
            alias.name
            for node in ast.walk(tree)
            if isinstance(node, ast.Import)
            for alias in node.names
        )
        assert not any(
            value.startswith(("scipy", "statsmodels", "numpy")) for value in imports
        ), name


def test_pages_use_shared_transport_and_formatters():
    for page in FRONTEND.glob("*.tsx"):
        source = page.read_text(encoding="utf-8")
        assert not re.search(r"\bfetch\(", source), page.name
        assert "Intl.NumberFormat" not in source, page.name
