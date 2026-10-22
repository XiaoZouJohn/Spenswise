from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.db import Base, get_db
from app.main import app
from app.services import imports


def test_preview_confirm_idempotent(tmp_path, monkeypatch):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'import.db'}", connect_args={"check_same_thread": False}
    )
    Base.metadata.create_all(engine)
    monkeypatch.setattr(imports, "UPLOAD_DIR", tmp_path / "uploads")
    monkeypatch.setenv("CELERY_ALWAYS_EAGER", "1")

    def test_db():
        with Session(engine) as db:
            yield db

    app.dependency_overrides[get_db] = test_db
    try:
        client = TestClient(app)
        assert (
            client.post(
                "/api/auth/register",
                json={
                    "email": "import@example.com",
                    "password": "safe-test-password-123",
                    "display_name": "导入用户",
                },
            ).status_code
            == 200
        )
        raw = "日期,金额,商户\n2026-09-28,12.34,测试店\n"
        preview = client.post(
            "/api/import/preview", files={"file": ("demo.csv", raw.encode(), "text/csv")}
        )
        assert preview.status_code == 200
        data = preview.json()
        assert data["mapping"]["date"] == "日期"
        request = {
            "token": data["token"],
            "mapping": {"date": "日期", "amount": "金额", "merchant": "商户"},
        }
        first = client.post("/api/import/confirm", json=request)
        second = client.post("/api/import/confirm", json=request)
        assert first.status_code == second.status_code == 200
        assert first.json()["inserted"] == second.json()["inserted"] == 1
        assert client.get("/api/transactions").json()["total"] == 1
    finally:
        app.dependency_overrides.clear()
