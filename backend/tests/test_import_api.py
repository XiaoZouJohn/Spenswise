import io

from fastapi.testclient import TestClient
from openpyxl import Workbook
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.db import Base, get_db
from app.main import app
from app.services import imports


def test_wechat_xlsx_preamble_and_preferred_mapping():
    book = Workbook()
    sheet = book.active
    sheet.append(["微信支付账单明细"])
    sheet.append(["微信昵称：[大学生用户]"])
    sheet.append(["起始时间：[2025-10-23] 截止时间：[2026-10-22]"])
    for _ in range(14):
        sheet.append([])
    sheet.append(
        [
            "交易时间",
            "交易类型",
            "交易对方",
            "商品",
            "收/支",
            "金额(元)",
            "支付方式",
            "当前状态",
            "交易单号",
            "商户单号",
            "备注",
        ]
    )
    sheet.append(
        [
            "2026-10-22 12:26:38",
            "商户消费",
            "中国移动话费充值",
            "手机话费",
            "支出",
            "￥59.00",
            "零钱",
            "支付成功",
            "WXTXN001",
            "WXM001",
            "/",
        ]
    )
    sheet.append(
        [
            "2026-10-21 08:30:00",
            "商户消费",
            "校园超市",
            "生活用品",
            "支出",
            25.5,
            "零钱",
            "已全额退款",
            "WXTXN002",
            "WXM002",
            "订单退款",
        ]
    )
    payload = io.BytesIO()
    book.save(payload)

    result = imports.preview("微信支付账单.xlsx", payload.getvalue())

    assert result["total"] == 2
    assert result["mapping"] == {
        "date": "交易时间",
        "amount": "金额(元)",
        "merchant": "交易对方",
        "description": "商品",
        "type": "收/支",
        "category": None,
    }
    first = imports.normalize_row(
        result["sample"][0], imports.ImportMapping.model_validate(result["mapping"])
    )
    refunded = imports.normalize_row(
        result["sample"][1], imports.ImportMapping.model_validate(result["mapping"])
    )
    assert first.amount_cents == 5900
    assert first.tx_type == "expense"
    assert refunded.tx_type == "refund"


def test_gb18030_csv_with_intro_rows_and_chinese_date():
    raw = (
        "支付宝账单,,\n"
        "导出时间,2026-10-22,\n"
        "交易时间,交易对方,金额（元）,收支,商品说明\n"
        "2026年10月20日 08:10:00,校园食堂,12.50,支出,早餐\n"
    ).encode("gb18030")

    result = imports.preview("支付宝账单.csv", raw)

    assert result["total"] == 1
    assert result["mapping"]["date"] == "交易时间"
    assert result["mapping"]["amount"] == "金额（元）"
    normalized = imports.normalize_row(
        result["sample"][0], imports.ImportMapping.model_validate(result["mapping"])
    )
    assert normalized.tx_date.isoformat() == "2026-10-20"
    assert normalized.amount_cents == 1250


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

        # A new preview of the same file rescans it. Existing transactions are
        # skipped, but deleted transactions can be restored by importing again.
        repeated_preview = client.post(
            "/api/import/preview", files={"file": ("demo.csv", raw.encode(), "text/csv")}
        ).json()
        repeated = client.post(
            "/api/import/confirm",
            json={"token": repeated_preview["token"], "mapping": request["mapping"]},
        )
        assert repeated.status_code == 200
        assert repeated.json()["inserted"] == 0
        assert repeated.json()["duplicates"] == 1

        assert client.delete("/api/transactions").status_code == 200
        assert client.get("/api/transactions").json()["total"] == 0
        restore_preview = client.post(
            "/api/import/preview", files={"file": ("demo.csv", raw.encode(), "text/csv")}
        ).json()
        restored = client.post(
            "/api/import/confirm",
            json={"token": restore_preview["token"], "mapping": request["mapping"]},
        )
        assert restored.status_code == 200
        assert restored.json()["inserted"] == 1
        assert client.get("/api/transactions").json()["total"] == 1
    finally:
        app.dependency_overrides.clear()
