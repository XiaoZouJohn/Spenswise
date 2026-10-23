import csv
import hashlib
import io
import os
import re
import uuid
from datetime import date, datetime
from itertools import islice
from pathlib import Path
from typing import Literal

from sqlalchemy.orm import Session

from app.models import ImportJob
from app.schemas import ImportMapping, TransactionIn

from .ledger import add_transaction
from .money import to_cents

UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", "./uploads"))
HEADER_SCAN_LIMIT = 120

FIELD_ALIASES = {
    "date": [
        "交易时间",
        "交易日期",
        "付款时间",
        "创建时间",
        "记账日期",
        "日期",
        "时间",
        "date",
        "datetime",
    ],
    "amount": [
        "金额(元)",
        "交易金额(元)",
        "交易金额",
        "订单金额",
        "付款金额",
        "支出金额",
        "金额",
        "amount",
    ],
    "merchant": [
        "交易对方",
        "商户名称",
        "对方名称",
        "收款方",
        "商家",
        "商户",
        "merchant",
        "payee",
    ],
    "description": [
        "商品",
        "商品说明",
        "商品名称",
        "交易说明",
        "订单说明",
        "用途",
        "备注",
        "说明",
        "description",
        "memo",
    ],
    # Exact matches are tried in this order. This deliberately prefers
    # WeChat's 收/支 column over the earlier 交易类型 column.
    "type": [
        "收/支",
        "收支",
        "收支类型",
        "资金方向",
        "借贷标记",
        "交易类型",
        "类型",
        "type",
    ],
    "category": ["消费分类", "交易分类", "账单分类", "分类", "category"],
}


def _header_key(value: object) -> str:
    return (
        str(value or "")
        .replace("\ufeff", "")
        .replace("（", "(")
        .replace("）", ")")
        .replace("／", "/")
        .replace("：", ":")
        .strip()
        .casefold()
    )


def _clean_header(value: object) -> str:
    return re.sub(r"\s+", "", str(value or "").replace("\ufeff", "")).strip()


def _unique_columns(values: list[object]) -> list[str]:
    columns: list[str] = []
    counts: dict[str, int] = {}
    for index, value in enumerate(values, start=1):
        base = _clean_header(value) or f"未命名列{index}"
        counts[base] = counts.get(base, 0) + 1
        columns.append(base if counts[base] == 1 else f"{base}_{counts[base]}")
    return columns


def _mapping_value(columns: list[str], aliases: list[str]) -> str | None:
    normalized = {column: _header_key(column) for column in columns}
    for alias in aliases:
        target = _header_key(alias)
        for column, value in normalized.items():
            if value == target:
                return column
    for alias in aliases:
        target = _header_key(alias)
        if len(target) < 2:
            continue
        for column, value in normalized.items():
            if target in value:
                return column
    return None


def _header_candidate(values: list[object]) -> tuple[int, list[str]] | None:
    columns = _unique_columns(values)
    non_empty = sum(bool(_clean_header(value)) for value in values)
    if non_empty < 2:
        return None
    mapping = guess_mapping(columns)
    recognized = sum(value is not None for value in mapping.values())
    required = int(mapping["date"] is not None) + int(mapping["amount"] is not None)
    # Recognized finance headers beat equally wide transaction rows. Unknown
    # formats still fall back to the first wide row so the user can map fields.
    return required * 100 + recognized * 10 + non_empty, columns


def _find_header(rows: list[list[object]]) -> tuple[int, list[str]]:
    best: tuple[int, int, list[str]] | None = None
    for index, values in enumerate(rows[:HEADER_SCAN_LIMIT]):
        candidate = _header_candidate(values)
        if candidate is None:
            continue
        score, columns = candidate
        if best is None or score > best[0]:
            best = (score, index, columns)
    if best is None:
        raise ValueError("没有找到可识别的表头，请确认文件中包含日期和金额列")
    return best[1], best[2]


def _rows_to_records(rows: list[list[object]], header_index: int, columns: list[str]) -> list[dict]:
    mapping = guess_mapping(columns)
    date_column = mapping.get("date")
    amount_column = mapping.get("amount")
    records: list[dict] = []
    for values in rows[header_index + 1 :]:
        if not any(value not in (None, "") for value in values):
            continue
        row = dict(zip(columns, values, strict=False))
        if date_column and amount_column:
            raw_date = row.get(date_column)
            raw_amount = row.get(amount_column)
            if raw_date in (None, "") and raw_amount in (None, ""):
                continue
            if _header_key(raw_date) == _header_key(date_column):
                continue
        records.append(row)
    return records


def _decode_delimited(data: bytes) -> str:
    encodings = (
        ["utf-16", "utf-8-sig", "gb18030"]
        if data.startswith((b"\xff\xfe", b"\xfe\xff"))
        else ["utf-8-sig", "gb18030", "utf-16"]
    )
    for encoding in encodings:
        try:
            return data.decode(encoding)
        except UnicodeError:
            continue
    raise ValueError("无法识别文件编码，请另存为 UTF-8、GB18030 或 UTF-16")


def _parse_delimited(data: bytes) -> list[dict]:
    text = _decode_delimited(data)
    try:
        dialect = csv.Sniffer().sniff(text[:8192], delimiters=",\t;")
    except csv.Error:
        dialect = csv.excel
    rows = [list(row) for row in csv.reader(io.StringIO(text), dialect)]
    header_index, columns = _find_header(rows)
    return _rows_to_records(rows, header_index, columns)


def _parse_xlsx(data: bytes) -> list[dict]:
    from openpyxl import load_workbook

    try:
        book = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    except Exception as exc:
        raise ValueError("Excel 文件无法读取，请确认文件未损坏且格式为 XLSX") from exc
    best: tuple[int, object, int, list[str]] | None = None
    for sheet in book.worksheets:
        sample = [list(row) for row in islice(sheet.iter_rows(values_only=True), HEADER_SCAN_LIMIT)]
        if not sample:
            continue
        try:
            header_index, columns = _find_header(sample)
        except ValueError:
            continue
        candidate = _header_candidate(sample[header_index])
        score = candidate[0] if candidate else 0
        if best is None or score > best[0]:
            best = (score, sheet, header_index, columns)
    if best is None:
        raise ValueError("Excel 中没有找到可导入的账单表格")
    _, sheet, header_index, columns = best
    rows = [list(row) for row in sheet.iter_rows(values_only=True)]
    records = _rows_to_records(rows, header_index, columns)
    book.close()
    return records


def parse_file(filename: str, data: bytes) -> list[dict]:
    suffix = Path(filename).suffix.lower()
    if suffix in {".csv", ".txt"}:
        return _parse_delimited(data)
    if suffix == ".xlsx":
        return _parse_xlsx(data)
    raise ValueError("仅支持 CSV、TXT 或 XLSX；旧版 XLS 请先另存为 XLSX")


def guess_mapping(columns: list[str]) -> dict:
    return {key: _mapping_value(columns, aliases) for key, aliases in FIELD_ALIASES.items()}


def _parse_date(value: object) -> date:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, (int, float)):
        from openpyxl.utils.datetime import from_excel

        return from_excel(value).date()
    text = str(value or "").strip()
    if not text:
        raise ValueError("日期为空")
    normalized = (
        text.replace("年", "-")
        .replace("月", "-")
        .replace("日", "")
        .replace("/", "-")
        .replace(".", "-")
    )
    match = re.search(r"\d{4}-\d{1,2}-\d{1,2}", normalized)
    if not match:
        raise ValueError(f"无法识别日期：{text}")
    year, month, day = (int(part) for part in match.group(0).split("-"))
    return date(year, month, day)


def _parse_amount(value: object) -> int:
    if isinstance(value, (int, float)):
        return to_cents(value)
    text = str(value or "").strip()
    if not text:
        raise ValueError("金额为空")
    negative_parentheses = text.startswith("(") and text.endswith(")")
    cleaned = re.sub(r"[\s,，¥￥元]", "", text.strip("()（）"))
    amount = to_cents(cleaned)
    return -abs(amount) if negative_parentheses else amount


def normalize_row(row: dict, mapping: ImportMapping) -> TransactionIn:
    tx_date = _parse_date(row.get(mapping.date))
    amount = _parse_amount(row.get(mapping.amount, ""))
    raw_type = str(row.get(mapping.type, "") if mapping.type else "").casefold()
    row_text = " ".join(str(value or "") for value in row.values()).casefold()
    tx_type: Literal["expense", "income", "transfer", "refund"] = (
        "refund"
        if any(token in row_text for token in ("退款", "refund", "退回"))
        else "income"
        if any(token in raw_type for token in ("收入", "收款", "入账", "income", "credit"))
        else "expense"
        if any(token in raw_type for token in ("支出", "付款", "expense", "debit"))
        else "transfer"
        if any(token in row_text for token in ("零钱通", "转账", "transfer", "余额宝"))
        else "expense"
    )
    return TransactionIn(
        tx_date=tx_date,
        amount_cents=abs(amount),
        tx_type=tx_type,
        merchant=str(row.get(mapping.merchant, "") or "").strip()[:255] if mapping.merchant else "",
        description=str(row.get(mapping.description, "") or "").strip()
        if mapping.description
        else "",
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
