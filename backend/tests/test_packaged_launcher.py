from __future__ import annotations

import importlib.util
import sqlite3
from pathlib import Path

from alembic import command
from alembic.config import Config

PROJECT_ROOT = Path(__file__).resolve().parents[2]


def load_launcher():
    path = PROJECT_ROOT / "packaging" / "launcher.py"
    spec = importlib.util.spec_from_file_location("spendwise_packaged_launcher", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def migration_config(database: Path) -> Config:
    config = Config()
    config.set_main_option("script_location", str(PROJECT_ROOT / "backend" / "migrations"))
    config.set_main_option("sqlalchemy.url", f"sqlite:///{database.as_posix()}")
    return config


def test_unversioned_initial_database_continues_to_head(tmp_path, monkeypatch):
    database = tmp_path / "spendwise.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{database.as_posix()}")
    config = migration_config(database)
    command.upgrade(config, "0001")
    with sqlite3.connect(database) as connection:
        connection.execute("DELETE FROM alembic_version")

    launcher = load_launcher()
    monkeypatch.setattr(launcher, "resource_dir", lambda: PROJECT_ROOT / "backend")
    launcher.migrate_database()

    with sqlite3.connect(database) as connection:
        assert connection.execute("SELECT version_num FROM alembic_version").fetchone() == ("0007",)
        asset_columns = {
            row[1] for row in connection.execute('PRAGMA table_info("asset_snapshots")')
        }
    assert {"ownership", "shared_account_key"}.issubset(asset_columns)
    assert (tmp_path / "spendwise.pre-migration-backup.db").is_file()


def test_richer_versioned_legacy_database_replaces_failed_shell(tmp_path, monkeypatch):
    current_root = tmp_path / "SpendWise"
    current_root.mkdir()
    current_database = current_root / "spendwise.db"
    with sqlite3.connect(current_database) as connection:
        connection.execute("CREATE TABLE alembic_version (version_num TEXT)")
        connection.execute("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)")
        connection.execute("INSERT INTO settings VALUES ('currency', 'CNY')")

    legacy_root = tmp_path / "SpendWise-v3.0"
    legacy_root.mkdir()
    legacy_database = legacy_root / "spendwise-v3.db"
    with sqlite3.connect(legacy_database) as connection:
        connection.execute("CREATE TABLE alembic_version (version_num TEXT)")
        connection.execute("INSERT INTO alembic_version VALUES ('0007')")
        connection.execute("CREATE TABLE users (id INTEGER PRIMARY KEY)")
        connection.executemany("INSERT INTO users VALUES (?)", [(1,), (2,)])
        connection.execute("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)")
        connection.execute("INSERT INTO settings VALUES ('currency', 'CNY')")

    launcher = load_launcher()
    monkeypatch.setattr(launcher, "local_app_data_root", lambda: tmp_path)
    monkeypatch.setattr(launcher, "executable_dir", lambda: tmp_path / "application")
    launcher.migrate_existing_data(current_root)

    with sqlite3.connect(current_database) as connection:
        assert connection.execute("SELECT version_num FROM alembic_version").fetchone() == ("0007",)
        assert connection.execute("SELECT COUNT(*) FROM users").fetchone() == (2,)
    assert (current_root / "spendwise.incomplete-backup.db").is_file()
