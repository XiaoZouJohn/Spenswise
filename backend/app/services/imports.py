import csv
import hashlib
import io
import os
import uuid
from datetime import date, datetime
from pathlib import Path
from typing import Literal

from sqlalchemy.orm import Session

from app.models import ImportJob
from app.schemas import ImportMapping, TransactionIn

from .ledger import add_transaction
from .money import to_cents

UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", "./uploads"))


def parse_file(filename: str, data: bytes) -> list[dict]:
    suffix = Path(filename).suffix.lower()
    if suffix == ".csv":
        text = data.decode("utf-8-sig")
        return list(csv.DictReader(io.StringIO(text)))
    if suffix == ".xlsx":
        from openpyxl import load_workbook

        book = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
        sheet = book.active
        values = sheet.iter_rows(values_only=True)
        columns = [str(x or "") for x in next(values)]
        return [dict(zip(columns, row, strict=False)) for row in values]
    raise ValueError("仅支持 CSV 或 XLSX")


def guess_mapping(columns: list[str]) -> dict:
    aliases = {
        "date": ["日期", "时间", "date", "交易时间"],
        "amount": ["金额", "amount", "交易金额"],
        "merchant": ["商户", "商家", "merchant", "交易对方"],
        "description": ["备注", "说明", "description", "商品说明"],
        "type": ["类型", "type", "收支类型"],
        "category": ["分类", "category"],
    }
    return {
        key: next(
            (col for col in columns if any(alias.lower() in col.lower() for alias in names)), None
        )
        for key, names in aliases.items()
    }


def normalize_row(row: dict, mapping: ImportMapping) -> TransactionIn:
    raw_date = row.get(mapping.date)
    if isinstance(raw_date, datetime):
        tx_date = raw_date.date()
    elif isinstance(raw_date, date):
        tx_date = raw_date
    else:
        value = str(raw_date or "").strip().replace("/", "-")
        tx_date = date.fromisoformat(value[:10])
    amount = to_cents(row.get(mapping.amount, ""))
    raw_type = str(row.get(mapping.type, "") if mapping.type else "").lower()
    tx_type: Literal["expense", "income", "transfer", "refund"] = (
        "refund"
        if "退款" in raw_type or "refund" in raw_type
        else "transfer"
        if "转账" in raw_type or "transfer" in raw_type
        else "income"
        if "收入" in raw_type or "income" in raw_type or amount < 0
        else "expense"
    )
    return TransactionIn(
        tx_date=tx_date,
        amount_cents=abs(amount),
        tx_type=tx_type,
        merchant=str(row.get(mapping.merchant, "") or "") if mapping.merchant else "",
        description=str(row.get(mapping.description, "") or "") if mapping.description else "",
        category=str(row.get(mapping.category, "待确认") or "待确认")
        if mapping.category
        else "待确认",
    )


def store_upload(filename: str, data: bytes) -> tuple[str, str]:
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    token = str(uuid.uuid4())
    (UPLOAD_DIR / token).write_bytes(data)
    (UPLOAD_DIR / f"{token}.name").write_text(Path(filename).name, encoding="utf-8")
    return token, hashlib.sha256(data).hexdigest()


def preview(filename: str, data: bytes, mapping: ImportMapping | None = None) -> dict:
    rows = parse_file(filename, data)
    columns = list(rows[0]) if rows else []
    suggestion = guess_mapping(columns)
    errors: list[dict[str, str | int]] = []
    result = {
        "columns": columns,
        "mapping": suggestion,
        "sample": rows[:10],
        "total": len(rows),
        "errors": errors,
    }
    if mapping:
        for index, row in enumerate(rows, start=2):
            try:
                normalize_row(row, mapping)
            except (ValueError, KeyError, TypeError) as exc:
                errors.append({"row": index, "message": str(exc)})
    return result


def process_import(db: Session, job: ImportJob, data: bytes) -> None:
    job.status = "running"
    db.commit()
    rows = parse_file(job.filename, data)
    mapping = ImportMapping.model_validate(job.mapping)
    for index, row in enumerate(rows, start=2):
        try:
            normalized = normalize_row(row, mapping)
            _, inserted = add_transaction(
                db, normalized, source=job.filename, owner_id=job.owner_id
            )
            job.inserted += int(inserted)
            job.duplicates += int(not inserted)
        except (ValueError, KeyError, TypeError) as exc:
            job.errors = [*job.errors, {"row": index, "message": str(exc)}]
    job.status = "completed"
    db.commit()
