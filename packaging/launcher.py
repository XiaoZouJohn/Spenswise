from __future__ import annotations

import os
import shutil
import socket
import sqlite3
import sys
import threading
import traceback
import urllib.request
import webbrowser
from pathlib import Path

APP_NAME = "SpendWise v3.0"
DATA_DIR_NAME = "SpendWise"
DEFAULT_PORT = 8765


def executable_dir() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parents[1]


def resource_dir() -> Path:
    return Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))


def local_app_data_root() -> Path:
    configured = os.getenv("LOCALAPPDATA")
    if configured:
        return Path(configured)
    return Path.home() / "AppData" / "Local"


def _copy_if_missing(source: Path, target: Path) -> bool:
    if target.exists() or not source.is_file():
        return False
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, target)
    return True


def _database_state(database: Path) -> tuple[str | None, int]:
    """Return the Alembic revision and a conservative user-data row count."""
    if not database.is_file():
        return None, 0
    try:
        with sqlite3.connect(database) as connection:
            tables = {
                row[0]
                for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
            }
            revision = None
            if "alembic_version" in tables:
                row = connection.execute(
                    "SELECT version_num FROM alembic_version LIMIT 1"
                ).fetchone()
                revision = str(row[0]) if row and row[0] else None

            # These tables contain user-created state. Counting them lets us recover
            # from a failed empty/partial database without replacing a richer one.
            payload_tables = (
                "transactions",
                "users",
                "settings",
                "category_budgets",
                "merchant_rules",
                "ai_connections",
                "chat_conversations",
                "chat_messages",
                "scenarios",
            )
            payload_rows = sum(
                connection.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
                for table in payload_tables
                if table in tables
            )
            return revision, int(payload_rows)
    except sqlite3.DatabaseError:
        return None, 0


def infer_unversioned_revision(database: Path) -> str | None:
    """Infer the latest completed migration for a legacy SQLite database."""
    if not database.is_file():
        return None
    with sqlite3.connect(database) as connection:
        tables = {
            row[0]
            for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
        }
        if "alembic_version" in tables:
            row = connection.execute("SELECT version_num FROM alembic_version LIMIT 1").fetchone()
            if row and row[0]:
                return None

        def columns(table: str) -> set[str]:
            if table not in tables:
                return set()
            return {row[1] for row in connection.execute(f'PRAGMA table_info("{table}")')}

        asset_columns = columns("asset_snapshots")
        if "shared_account_key" in asset_columns:
            return "0007"
        if "ownership" in asset_columns:
            return "0006"
        if {"users", "households", "asset_snapshots"}.issubset(tables):
            return "0005"
        if "used_ledger" in columns("chat_conversations"):
            return "0004"
        if {"ai_connections", "chat_conversations", "chat_messages"}.issubset(tables):
            return "0003"
        if "category_budgets" in tables:
            return "0002"
        initial_tables = {
            "transactions",
            "settings",
            "merchant_rules",
            "scenarios",
            "import_jobs",
        }
        if initial_tables.issubset(tables):
            return "0001"
    return None


def migrate_existing_data(target: Path) -> None:
    """Bring earlier v3/source-run data forward once without overwriting anything."""
    legacy_root = local_app_data_root() / "SpendWise-v3.0"
    candidates = [
        (
            legacy_root / "spendwise-v3.db",
            legacy_root / "uploads",
            legacy_root / "ai-key" / "fernet.key",
        ),
        (
            executable_dir() / "data" / "spendwise-v3.db",
            executable_dir() / "data" / "uploads",
            executable_dir() / "data" / "ai-key" / "fernet.key",
        ),
        (
            executable_dir() / "backend" / "spendwise-dev.db",
            executable_dir() / "backend" / "uploads",
            executable_dir() / "backend" / "ai-key" / "fernet.key",
        ),
    ]
    target_db = target / "spendwise.db"
    target_uploads = target / "uploads"
    target_key = target / "ai-key" / "fernet.key"

    # An earlier launch may have left a database with tables but no migration
    # revision. Prefer a richer, valid v3 database when one is available.
    target_revision, target_rows = _database_state(target_db)
    if target_db.is_file() and not target_revision:
        for database, uploads, key_file in candidates:
            source_revision, source_rows = _database_state(database)
            if not source_revision or source_rows <= target_rows:
                continue
            backup = target / "spendwise.incomplete-backup.db"
            _copy_if_missing(target_db, backup)
            shutil.copy2(database, target_db)
            if uploads.is_dir():
                shutil.copytree(uploads, target_uploads, dirs_exist_ok=True)
            _copy_if_missing(key_file, target_key)
            return

    for database, uploads, key_file in candidates:
        if not _copy_if_missing(database, target_db):
            continue
        if uploads.is_dir():
            shutil.copytree(uploads, target_uploads, dirs_exist_ok=True)
        _copy_if_missing(key_file, target_key)
        break


def app_data_dir() -> Path:
    target = local_app_data_root() / DATA_DIR_NAME
    target.mkdir(parents=True, exist_ok=True)
    migrate_existing_data(target)
    return target


def load_env(path: Path) -> None:
    if not path.is_file():
        return
    for raw_line in path.read_text(encoding="utf-8-sig").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key:
            os.environ[key] = value


def existing_instance_url(port: int = DEFAULT_PORT) -> str | None:
    url = f"http://127.0.0.1:{port}"
    try:
        with urllib.request.urlopen(f"{url}/api/health", timeout=0.8) as response:
            if response.status == 200 and b'"ok"' in response.read(200):
                return url
    except Exception:
        return None
    return None


def choose_port(preferred: int = DEFAULT_PORT) -> int:
    for port in range(preferred, preferred + 20):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            try:
                sock.bind(("127.0.0.1", port))
            except OSError:
                continue
            return port
    raise RuntimeError("无法找到可用的本地端口，请关闭其他 SpendWise 窗口后重试。")


def configure_runtime(port: int) -> tuple[Path, Path]:
    data_dir = app_data_dir()
    for config_path in (executable_dir() / "SpendWise.env", data_dir / "SpendWise.env"):
        load_env(config_path)

    database_path = data_dir / "spendwise.db"
    upload_dir = data_dir / "uploads"
    key_file = data_dir / "ai-key" / "fernet.key"
    upload_dir.mkdir(parents=True, exist_ok=True)
    key_file.parent.mkdir(parents=True, exist_ok=True)

    # Packaged mode always uses absolute, version-independent paths. This
    # avoids writing into PyInstaller's temporary extraction directory.
    os.environ["DATABASE_URL"] = f"sqlite:///{database_path.as_posix()}"
    os.environ["UPLOAD_DIR"] = str(upload_dir)
    os.environ["AI_KEY_FILE"] = str(key_file)
    os.environ["CELERY_ALWAYS_EAGER"] = "1"
    os.environ["CORS_ORIGINS"] = f"http://127.0.0.1:{port},http://localhost:{port}"
    return data_dir, database_path


def migrate_database() -> None:
    from alembic import command
    from alembic.config import Config

    migration_root = resource_dir() / "migrations"
    if not (migration_root / "env.py").is_file():
        raise RuntimeError(f"数据库迁移资源缺失：{migration_root}")
    config = Config()
    config.set_main_option("script_location", str(migration_root))
    config.set_main_option("sqlalchemy.url", os.environ["DATABASE_URL"])

    from sqlalchemy.engine import make_url

    database_url = make_url(os.environ["DATABASE_URL"])
    if database_url.drivername.startswith("sqlite") and database_url.database:
        database_path = Path(database_url.database)
        inferred_revision = infer_unversioned_revision(database_path)
        if inferred_revision:
            backup = database_path.with_name("spendwise.pre-migration-backup.db")
            _copy_if_missing(database_path, backup)
            print("检测到旧版数据库，" f"正在从迁移版本 {inferred_revision} 继续升级。")
            command.stamp(config, inferred_revision)
    command.upgrade(config, "head")


def build_app():
    from fastapi import HTTPException
    from fastapi.responses import FileResponse

    migrate_database()

    from app.main import app
    from app.tasks import celery_app

    celery_app.conf.task_always_eager = True
    celery_app.conf.task_eager_propagates = True

    static_root = resource_dir() / "frontend_dist"
    if not (static_root / "index.html").is_file():
        raise RuntimeError(f"前端资源缺失：{static_root}")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_frontend(full_path: str):
        candidate = (static_root / full_path).resolve()
        try:
            candidate.relative_to(static_root.resolve())
        except ValueError as exc:
            raise HTTPException(status_code=404) from exc
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(static_root / "index.html")

    return app


def open_browser(url: str) -> None:
    try:
        webbrowser.open(url, new=1)
    except Exception:
        pass


def main() -> int:
    try:
        if hasattr(sys.stdout, "reconfigure"):
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")

        running_url = existing_instance_url()
        if running_url:
            print(f"SpendWise 已在运行，正在打开：{running_url}")
            open_browser(running_url)
            return 0

        port = choose_port()
        data_dir, database_path = configure_runtime(port)
        app = build_app()
        url = f"http://127.0.0.1:{port}"

        print("=" * 58)
        print(" SpendWise v3.0 已启动")
        print(f" 访问地址：{url}")
        print(f" 数据位置：{data_dir}")
        print(f" 数据库：  {database_path.name}")
        print(" 账单、预算、账号和 AI 配置会保留到下次启动。")
        print(" 关闭本窗口即可停止服务。")
        print("=" * 58)

        if os.getenv("SPENDWISE_NO_BROWSER") != "1":
            threading.Timer(1.2, open_browser, args=(url,)).start()

        import uvicorn

        uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning", access_log=False)
        return 0
    except KeyboardInterrupt:
        return 0
    except Exception:
        print("\nSpendWise 启动失败：")
        traceback.print_exc()
        try:
            input("\n按回车键关闭窗口……")
        except EOFError:
            pass
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
