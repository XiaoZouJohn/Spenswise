"""Create an isolated, synthetic student account for the product video."""

import csv
import random
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from sqlalchemy import select

from app.db import SessionLocal
from app.models import LifeLog, User
from app.schemas import ImportMapping
from app.services import budget, monthly_review, village_journey
from app.services.imports import guess_mapping, normalize_row, parse_file
from scripts import seed_achievement_demo as base

ROOT = Path(__file__).resolve().parents[2]
DATABASE_URL = "sqlite:///./spendwise-video-demo.db"
EMAIL = "student.demo@spendwise.local"
CSV_PATH = ROOT / "dist" / "学生演示账单_202606-202611.csv"
CREDENTIALS_PATH = ROOT / "dist" / "学生演示账号.txt"
MONTHS = [f"2026-{month:02d}" for month in range(6, 12)]


def build_rows() -> list[dict[str, str | int]]:
    rng = random.Random(20261121)
    today = datetime.now(ZoneInfo("Asia/Shanghai")).date()
    rows: list[dict[str, str | int]] = []

    def add(month: str, day: int, merchant: str, category: str, yuan: float,
            description: str, tx_type: str = "expense") -> None:
        tx_date = date.fromisoformat(f"{month}-{day:02d}")
        if tx_date > today:
            return
        rows.append({"tx_date": tx_date.isoformat(), "amount_cents": round(yuan * 100),
                     "tx_type": tx_type, "merchant": merchant,
                     "description": description, "category": category})

    for month in MONTHS:
        add(month, 1, "家庭生活费", "收入", 3000, "每月生活费", "income")
        if month in ("2026-07", "2026-09", "2026-10"):
            add(month, 18, "校园勤工助学", "收入", rng.randint(90, 170), "兼职结算", "income")
        add(month, 8, "中国移动", "通讯", 59, "校园电话套餐")
        add(month, 9, "哔哩哔哩", "娱乐", 15, "会员续费")
        add(month, 13, "校园打印店", "学习", rng.randint(18, 44), "打印与文具")
        add(month, 16, "京东", "购物", rng.randint(89, 189), "生活用品")
        add(month, 22, "盒马", "日用品", rng.randint(65, 135), "日常采购")
        add(month, 25, "电影院", "娱乐", rng.randint(38, 68), "周末电影")
        add(month, 27, "朋友聚餐", "人情往来", rng.randint(70, 130), "朋友聚餐")
        for day in range(2, 29):
            if date.fromisoformat(f"{month}-{day:02d}") > today:
                continue
            if day % 2:
                add(month, day, "校园食堂", "餐饮", rng.randint(35, 53), "午餐与晚餐")
            else:
                add(month, day, "美团外卖", "餐饮", rng.randint(40, 58), "外卖晚餐")
            if day % 3 == 0:
                add(month, day, "校园食堂", "餐饮", rng.randint(7, 13), "早餐")
            if day % 4 == 0:
                add(month, day, "广州地铁", "交通", rng.randint(4, 9), "地铁出行")
            if day % 5 == 0:
                add(month, day, "便利店", "零食", rng.randint(12, 28), "饮料零食")
        for day in (6, 12, 19, 24):
            add(month, day, "滴滴出行", "交通", rng.randint(14, 35), "市内出行")
        for day in (5, 12, 19, 26):
            add(month, day, "朋友聚餐", "餐饮", rng.randint(48, 72), "周末聚餐")
        for day in (10, 20):
            add(month, day, "拼多多", "购物", rng.randint(60, 130), "学习与生活用品")
    return sorted(rows, key=lambda row: (str(row["tx_date"]), str(row["merchant"])))


def write_import_csv() -> None:
    """Export yuan-denominated columns recognized by the bill import preview."""
    rng = random.Random(20261121)
    columns = ["交易时间", "交易对方", "商品", "收/支", "金额(元)", "消费分类"]
    CSV_PATH.parent.mkdir(parents=True, exist_ok=True)
    with CSV_PATH.open("w", encoding="utf-8-sig", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=columns)
        writer.writeheader()
        for row in build_rows():
            cents = int(row["amount_cents"])
            description = str(row["description"])
            hour_range = (
                (7, 9) if description == "早餐"
                else (17, 21) if "晚餐" in description or "聚餐" in description
                else (11, 19) if "午餐" in description
                else (9, 12) if row["tx_type"] == "income"
                else (9, 21)
            )
            writer.writerow({
                "交易时间": f"{row['tx_date']} {rng.randint(*hour_range):02d}:{rng.randint(0, 59):02d}:00",
                "交易对方": row["merchant"],
                "商品": row["description"],
                "收/支": "收入" if row["tx_type"] == "income" else "支出",
                "金额(元)": f"{cents // 100}.{cents % 100:02d}",
                "消费分类": row["category"],
            })


def load_rows_from_current_csv() -> list[dict[str, str | int]]:
    """Use the delivered bill as the sole source for the demo account."""
    records = parse_file(CSV_PATH.name, CSV_PATH.read_bytes())
    if not records:
        raise ValueError("演示账单为空")
    mapping = ImportMapping(**guess_mapping(list(records[0])))
    rows: list[dict[str, str | int]] = []
    for record in records:
        item = normalize_row(record, mapping)
        rows.append({
            "tx_date": item.tx_date.isoformat(),
            "amount_cents": item.amount_cents,
            "tx_type": item.tx_type,
            "merchant": item.merchant,
            "description": item.description,
            "category": item.category,
        })
    return rows


def main() -> None:
    import os

    if os.getenv("DATABASE_URL") != DATABASE_URL:
        raise SystemExit(f"仅允许演示数据库：{DATABASE_URL}")
    base.EMAIL = EMAIL
    base.CSV_PATH = ROOT / "backend" / "uploads" / "student-seed-internal.csv"
    base.CREDENTIALS_PATH = CREDENTIALS_PATH
    base.MONTHS = MONTHS
    base.ALLOWED_DATABASES = {DATABASE_URL}
    base.build_rows = load_rows_from_current_csv
    base.main()
    student_logs = [
        ("月初整理生活费", "本月生活费到账，先留出餐饮、交通和通讯的预算。"),
        ("一次朋友聚餐", "周末和同学吃饭，想看看人情往来在账本里占多少。"),
        ("减少外卖次数", "这周多去食堂，外卖少了一些，月底再比较变化。"),
        ("学习用品采购", "打印材料和购买文具，都是这段时间的学习支出。"),
        ("一次周末出行", "地铁和打车都记下来，比较不同出行方式的花费。"),
        ("下个月的计划", "希望继续把生活费控制在预算内，留一点机动金额。"),
    ]
    with SessionLocal.begin() as db:
        user = db.scalar(select(User).where(User.email == EMAIL))
        assert user is not None
        budget.save_settings(db, {"monthly_budget_cents": 300000,
                                  "opening_balance_cents": 0}, user.id)
        for index, (title, content) in enumerate(student_logs):
            log = db.scalar(select(LifeLog).where(
                LifeLog.owner_id == user.id,
                LifeLog.event_date == date(2026, 6 + index, 18),
                LifeLog.deleted.is_(False)))
            if log:
                log.title, log.content = title, content
        for month in MONTHS[:-1]:
            review = monthly_review.read(db, user.id, month)
            monthly_review.save(db, user.id, month, {
                "revision": review["revision"],
                "ledger_version": review["ledger_version"],
                "notes": f"{month}：生活费覆盖日常支出，月底留有结余。",
                "constraints": "继续关注餐饮和购物支出",
                "differences": "",
                "life_log_ids": [],
            })
        earned = [a for a in village_journey.read(db, user.id)["achievements"]
                  if a["unlocked_at"]]
        if len(earned) != 6:
            raise RuntimeError(f"预期解锁六项成就，实际为 {len(earned)} 项")
    CREDENTIALS_PATH.write_text(
        CREDENTIALS_PATH.read_text(encoding="utf-8").replace(
            "数据库: backend/spendwise-video-demo.db",
            "启动: 双击同目录的 启动学生演示.cmd（使用独立演示数据库）",
        ),
        encoding="utf-8",
    )
    print(f"学生演示账号已就绪：{EMAIL}，{len(load_rows_from_current_csv())} 笔账单，6/6 成就")


if __name__ == "__main__":
    main()
