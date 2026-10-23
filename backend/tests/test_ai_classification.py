from datetime import date

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.db import Base
from app.models import Transaction, User
from app.services import ai


def test_ai_review_accepts_fenced_json_and_normalizes_fields(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'ai-review.db'}")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        db.add(
            User(
                id=1,
                email="owner@example.com",
                display_name="Owner",
                password_hash="test",
            )
        )
        db.add_all(
            [
                Transaction(
                    id=1,
                    owner_id=1,
                    tx_date=date(2026, 10, 22),
                    amount_cents=1800,
                    tx_type="expense",
                    merchant="某大学第二食堂",
                    description="午餐",
                    category="待确认",
                    fingerprint="owner-1-lunch",
                ),
                Transaction(
                    id=2,
                    owner_id=1,
                    tx_date=date(2026, 10, 22),
                    amount_cents=5000,
                    tx_type="transfer",
                    merchant="微信转账",
                    description="同学代付",
                    category="待确认",
                    fingerprint="owner-1-transfer",
                ),
            ]
        )
        db.commit()

        monkeypatch.setattr(ai, "enabled", lambda _db, _owner_id: True)
        monkeypatch.setattr(
            ai,
            "ask",
            lambda *_args: """```json
            [
              {"id":"1","category":"餐饮","confidence":94,"reason":"校园食堂午餐"},
              {"id":2,"category":"转账","confidence":120,"reason":"交易类型为转账"}
            ]
            ```""",
        )

        suggestions = ai.review(db, [1, 2], owner_id=1)
        applied = ai.apply_suggestions(db, suggestions, owner_id=1)
        db.commit()
        first = db.get(Transaction, 1)
        assert first is not None
        assert first.category == "餐饮"
        assert first.confidence == 94
        assert first.classification_reason == "DeepSeek：校园食堂午餐"

    assert suggestions == [
        {
            "id": 1,
            "category": "餐饮",
            "confidence": 94,
            "reason": "校园食堂午餐",
            "merchant": "某大学第二食堂",
            "description": "午餐",
            "current_category": "待确认",
        },
        {
            "id": 2,
            "category": "转账",
            "confidence": 100,
            "reason": "交易类型为转账",
            "merchant": "微信转账",
            "description": "同学代付",
            "current_category": "待确认",
        },
    ]
    assert applied["updated"] == 2
    assert applied["before"][0]["category"] == "待确认"


def test_ai_review_rejects_more_than_thirty_items(monkeypatch):
    monkeypatch.setattr(ai, "enabled", lambda _db, _owner_id: True)
    try:
        ai.review(None, list(range(31)), owner_id=1)
    except ValueError as exc:
        assert "30" in str(exc)
    else:
        raise AssertionError("Expected the classification batch limit to be enforced")


def test_ai_review_all_groups_repeated_transactions(tmp_path, monkeypatch):
    engine = create_engine(f"sqlite:///{tmp_path / 'ai-review-all.db'}")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        db.add(User(id=1, email="owner@example.com", display_name="Owner", password_hash="test"))
        db.add_all(
            [
                Transaction(
                    id=1,
                    owner_id=1,
                    tx_date=date(2026, 10, 20),
                    amount_cents=1800,
                    tx_type="expense",
                    merchant="某大学第二食堂",
                    description="午餐",
                    category="待确认",
                    fingerprint="all-owner-1-lunch-1",
                ),
                Transaction(
                    id=2,
                    owner_id=1,
                    tx_date=date(2026, 10, 21),
                    amount_cents=2000,
                    tx_type="expense",
                    merchant="某大学第二食堂",
                    description="午餐",
                    category="待确认",
                    fingerprint="all-owner-1-lunch-2",
                ),
                Transaction(
                    id=3,
                    owner_id=1,
                    tx_date=date(2026, 10, 22),
                    amount_cents=300,
                    tx_type="expense",
                    merchant="校园公交",
                    description="乘车码",
                    category="待确认",
                    fingerprint="all-owner-1-bus",
                ),
                Transaction(
                    id=4,
                    owner_id=1,
                    tx_date=date(2026, 10, 22),
                    amount_cents=9900,
                    tx_type="expense",
                    merchant="书店",
                    description="教材",
                    category="教育",
                    fingerprint="all-owner-1-confirmed",
                ),
            ]
        )
        db.commit()

        payload_sizes = []

        def fake_ask(messages, _db, _owner_id):
            payload = __import__("json").loads(messages[1]["content"])
            payload_sizes.append(len(payload))
            return __import__("json").dumps(
                [
                    {
                        "id": item["id"],
                        "category": (
                            "餐饮"
                            if "食堂" in item["merchant"]
                            else "教育"
                            if "书店" in item["merchant"]
                            else "交通"
                        ),
                        "confidence": 90,
                        "reason": "商户用途明确",
                    }
                    for item in payload
                ],
                ensure_ascii=False,
            )

        monkeypatch.setattr(ai, "enabled", lambda _db, _owner_id: True)
        monkeypatch.setattr(ai, "ask", fake_ask)

        result = ai.review_all(db, owner_id=1)

    assert result["total"] == 4
    assert result["groups_reviewed"] == 3
    assert payload_sizes == [3]
    assert [item["id"] for item in result["suggestions"]] == [1, 2, 3, 4]
    assert [item["category"] for item in result["suggestions"]] == [
        "餐饮",
        "餐饮",
        "交通",
        "教育",
    ]
