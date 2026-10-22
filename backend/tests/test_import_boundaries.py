"""Keep API and workers dependent on services, never the reverse."""

import ast
from pathlib import Path

APP_DIR = Path(__file__).resolve().parents[1] / "app"


def test_api_routes_import_service_modules_instead_of_algorithm_functions():
    """Route authors call ``service.operation`` so the owner of each rule is visible."""
    for path in (APP_DIR / "main.py", *APP_DIR.glob("routes_*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if not isinstance(node, ast.ImportFrom) or node.module is None:
                continue
            is_direct_service_import = (
                node.level == 1 and node.module.startswith("services.")
            ) or node.module.startswith("app.services.")
            assert not is_direct_service_import, (
                f"{path.name}:{node.lineno} imports a service function directly; "
                "import the service module and call its public operation"
            )


def test_services_do_not_depend_on_http_routes():
    for path in (APP_DIR / "services").glob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom):
                module = node.module or ""
                imports_route = module in {"main", "routes_auth", "routes_family"} or (
                    module.startswith(("app.main", "app.routes_"))
                )
                assert not imports_route, f"{path.name}:{node.lineno} imports an HTTP route"
            if isinstance(node, ast.Import):
                assert all(
                    name.name != "app.main" and not name.name.startswith("app.routes_")
                    for name in node.names
                ), f"{path.name}:{node.lineno} imports an HTTP route"
