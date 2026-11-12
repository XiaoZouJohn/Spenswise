"""Bounded, current-owner ledger reader exposed as a DeepSeek function tool."""

from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Transaction

TOOL = {
    "type": "function",
    "function": {
        "name": "view_ledger",
        "description": (
            "按需查看当前登录用户的最新账本。可按日期、分类、商户和收支类型筛选；"
            "仅返回最多100笔及匹配笔数，不含备注。"
            "用户提到账单或需要核对最新交易时调用。"
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "start_date": {"type": "string", "description": "起始日期 YYYY-MM-DD，可不填"},
                "end_date": {"type": "string", "description": "结束日期 YYYY-MM-DD，可不填"},
                "category": {"type": "string", "description": "分类完全匹配，可不填"},
                "merchant": {"type": "string", "description": "商户名称包含，可不填"},
                "tx_type": {
                    "type": "string",
                    "enum": ["expense", "income", "refund", "transfer"],
                },
                "limit": {"type": "integer", "minimum": 1, "maximum": 100},
            },
            "additionalProperties": False,
        },
    },
}


def view_ledger(db: Session, owner_id: int, arguments: dict) -> dict:
    if not isinstance(arguments, dict) or set(arguments) - {
        "start_date",
        "end_date",
        "category",
        "merchant",
        "tx_type",
        "limit",
    }:
        raise ValueError("账本筛选条件无效")
    try:
        start = date.fromisoformat(arguments["start_date"]) if "start_date" in arguments else None
        end = date.fromisoformat(arguments["end_date"]) if "end_date" in arguments else None
    except (TypeError, ValueError) as exc:
        raise ValueError("账本日期条件无效") from exc
    if start and end and start > end:
        raise ValueError("起始日期不能晚于结束日期")
    category = arguments.get("category")
    if category is not None and (not isinstance(category, str) or len(category) > 80):
        raise ValueError("分类条件无效")
    merchant = arguments.get("merchant")
    if merchant is not None and (not isinstance(merchant, str) or len(merchant) > 100):
        raise ValueError("商户条件无效")
    tx_type = arguments.get("tx_type")
    if tx_type is not None and (
        not isinstance(tx_type, str) or tx_type not in {"expense", "income", "refund", "transfer"}
    ):
        raise ValueError("收支类型无效")
    limit = arguments.get("limit", 50)
    if type(limit) is not int or not 1 <= limit <= 100:
        raise ValueError("最多读取100笔账单")
    conditions = [Transaction.owner_id == owner_id]
    if start:
        conditions.append(Transaction.tx_date >= start)
    if end:
        conditions.append(Transaction.tx_date <= end)
    if category:
        conditions.append(Transaction.category == category)
    if merchant:
        conditions.append(Transaction.merchant.contains(merchant))
    if tx_type:
        conditions.append(Transaction.tx_type == tx_type)
    count = db.scalar(select(func.count(Transaction.id)).where(*conditions)) or 0
    rows = db.scalars(
        select(Transaction)
        .where(*conditions)
        .order_by(Transaction.tx_date.desc(), Transaction.id.desc())
        .limit(limit)
    ).all()
    return {
        "matched_count": count,
        "returned_count": len(rows),
        "truncated": count > len(rows),
        "transactions": [
            {
                "id": row.id,
                "date": row.tx_date.isoformat(),
                "merchant": row.merchant[:100],
                "category": row.category,
                "type": row.tx_type,
                "amount_cents": row.amount_cents,
            }
            for row in rows
        ],
    }
