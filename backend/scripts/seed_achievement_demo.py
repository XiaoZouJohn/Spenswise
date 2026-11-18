"""Seed a six-month demo account in an explicitly selected local SQLite database.

Run after Alembic. Existing users and their data are left untouched.
The account, login history and transactions are explicitly synthetic.
"""

import csv
import json
import os
import random
import secrets
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from sqlalchemy import select

from app.auth import password_hash
from app.db import SessionLocal
from app.models import LifeLog, Setting, User
from app.schemas import TransactionIn
from app.services import budget, ledger, monthly_review, village_journey
from app.services.village_life import save_log

ROOT = Path(__file__).resolve().parents[1]
CSV_PATH = ROOT / "demo" / "achievement_bills_2026-06_to_2026-11.csv"
CREDENTIALS_PATH = ROOT / "uploads" / "achievement-demo-credentials.txt"
EMAIL = "achievement.demo@spendwise.local"
MONTHS = [f"2026-{number:02d}" for number in range(6, 12)]
ALLOWED_DATABASES = {
    "sqlite:///./spendwise-dev.db",
    "sqlite:///./spendwise-achievement-demo-20261118.db",
}


def build_rows() -> list[dict[str, str | int]]:
    randomizer = random.Random(20261118)
    rows: list[dict[str, str | int]] = []

    def add(
        month: str,
        day: int,
        merchant: str,
        category: str,
        amount: int,
        description: str,
        tx_type: str = "expense",
    ) -> None:
        rows.append(
            {
                "tx_date": f"{month}-{day:02d}",
                "amount_cents": amount,
                "tx_type": tx_type,
                "merchant": merchant,
                "description": description,
                "category": category,
            }
        )

    for month in MONTHS:
        add(
            month,
            5,
            "字节跳动",
            "收入",
            randomizer.randint(14500, 17200) * 100,
            "模拟月薪",
            "income",
        )
        add(month, 21, "美团", "收入", randomizer.randint(350, 900) * 100, "模拟兼职结算", "income")
        add(month, 6, "自如", "居住", randomizer.randint(3700, 4300) * 100, "月租")
        add(month, 9, "中国移动", "通讯", randomizer.randint(109, 159) * 100, "通信套餐")
        for day in (3, 11, 19, 27):
            add(month, day, "盒马", "日用品", randomizer.randint(180, 430) * 100, "生鲜与日用品")
        for day in (2, 8, 14, 20, 26):
            add(month, day, "美团", "餐饮", randomizer.randint(28, 82) * 100, "餐饮订单")
        for day in (12, 24):
            add(month, day, "京东", "购物", randomizer.randint(120, 490) * 100, "生活用品")
        for day in (7, 17, 25):
            add(month, day, "滴滴", "交通", randomizer.randint(26, 95) * 100, "市内出行")
        add(month, 16, "星巴克", "餐饮", randomizer.randint(29, 43) * 100, "咖啡")
    today = datetime.now(ZoneInfo("Asia/Shanghai")).date()
    return sorted(
        (row for row in rows if date.fromisoformat(str(row["tx_date"])) <= today),
        key=lambda row: (str(row["tx_date"]), str(row["merchant"])),
    )


def main() -> None:
    database_url = os.getenv("DATABASE_URL")
    if database_url not in ALLOWED_DATABASES:
        raise SystemExit("只允许写入显式选择的本地演示库或 spendwise-dev.db")
    if datetime.now(ZoneInfo("Asia/Shanghai")).date() < datetime(2026, 11, 1).date():
        raise SystemExit("演示数据要求当前日期不早于 2026-11-01")
    rows = build_rows()
    CSV_PATH.parent.mkdir(parents=True, exist_ok=True)
    with CSV_PATH.open("w", encoding="utf-8-sig", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    password = secrets.token_urlsafe(18)
    if CREDENTIALS_PATH.exists():
        for line in CREDENTIALS_PATH.read_text(encoding="utf-8").splitlines():
            if line.startswith("密码: "):
                password = line.removeprefix("密码: ")
                break
    with SessionLocal.begin() as db:
        existing = db.scalars(select(User)).all()
        user = next((user for user in existing if user.email == EMAIL), None)
        if user is None:
            user = User(
                email=EMAIL, display_name="成就演示村民", password_hash=password_hash(password)
            )
            db.add(user)
            db.flush()
        else:
            user.password_hash = password_hash(password)
        budget.save_settings(
            db, {"monthly_budget_cents": 900000, "opening_balance_cents": 0}, user.id
        )
        inserted = 0
        for row in rows:
            _, added = ledger.add_transaction(
                db, TransactionIn(**row), source="demo", owner_id=user.id
            )
            inserted += int(added)
        demo_logs = [
            ("换了通勤路线", "这月试了两条上班的路，坐地铁虽然要多走一段，"
             "但比打车稳多了。早上也不用总盯着堵车时间，感觉轻松一点。"),
            ("把家里收拾了一遍", "周末去盒马买了些日用品，顺手把厨房柜子整理了。"
             "发现有几样东西之前囤多了，下个月买菜前先看看家里还有什么。"),
            ("周末和朋友吃饭", "这个月和老朋友见了两次，聊得挺开心。"
             "餐饮比平时多花了一点，不过都是想去的地方，下个月少点几次外卖就好。"),
            ("开始记日常小开销", "最近发现咖啡和临时买的小东西加起来也不少。"
             "我先记着，不急着给自己定太死的规矩，月底再看看哪些是真的常用。"),
            ("天气转凉了", "换季买了几件需要的东西，网购那几笔看着有点密。"
             "好在这个月收入还算稳定，接下来先把购物车放两天再决定要不要买。"),
            ("这个月想留点余量", "前半个月花销还算平稳。年底可能会和朋友出去玩，"
             "打算先留一笔钱，平时买东西也稍微想一想，别到时候手忙脚乱。"),
        ]
        for index, (title, content) in enumerate(demo_logs):
            event_date = date(2026, 6 + index, 18)
            marker = db.get(Setting, (user.id, f"demo_log:{index}"))
            if marker is None:
                save_log(
                    db,
                    user.id,
                    {
                        "event_date": event_date,
                        "title": title,
                        "content": content,
                        "visibility": "private",
                        "ai_allowed": False,
                        "revision": 0,
                        "transaction_ids": [],
                    },
                )
                db.add(Setting(owner_id=user.id, key=f"demo_log:{index}", value="1"))
            else:
                old_log = db.scalar(
                    select(LifeLog).where(
                        LifeLog.owner_id == user.id,
                        LifeLog.event_date == event_date,
                        LifeLog.content.like("演示生活记录：%"),
                    )
                )
                if old_log is not None:
                    old_log.title = title
                    old_log.content = content
        for month in MONTHS[:-1]:
            review = monthly_review.read(db, user.id, month)
            if review["saved_at"] is None:
                monthly_review.save(
                    db,
                    user.id,
                    month,
                    {
                        "revision": review["revision"],
                        "ledger_version": review["ledger_version"],
                        "notes": f"{month} 收支计划回顾：收入覆盖支出，消费控制在预算内。",
                        "constraints": "继续留出日常储蓄",
                        "differences": "",
                        "life_log_ids": [],
                    },
                )
        today = datetime.now(ZoneInfo("Asia/Shanghai"))
        login = db.get(Setting, (user.id, village_journey.LOGIN_KEY))
        login_value = json.dumps(
            {
                "last_date": today.date().isoformat(),
                "streak": 7,
                "awards": {"3": (today - timedelta(days=4)).isoformat(), "7": today.isoformat()},
                "synthetic_demo": True,
            }
        )
        if login:
            login.value = login_value
        else:
            db.add(Setting(owner_id=user.id, key=village_journey.LOGIN_KEY, value=login_value))
        result = village_journey.read(db, user.id)
        if len([a for a in result["achievements"] if a["unlocked_at"]]) != 6:
            raise RuntimeError("演示数据未满足全部六项成就")
    CREDENTIALS_PATH.parent.mkdir(parents=True, exist_ok=True)
    CREDENTIALS_PATH.write_text(
        f"邮箱: {EMAIL}\n密码: {password}\n数据库: backend/{database_url.removeprefix('sqlite:///./')}\n",
        encoding="utf-8",
    )
    print(
        json.dumps(
            {
                "email": EMAIL,
                "password": password,
                "csv": str(CSV_PATH),
                "inserted": inserted,
                "total": len(rows),
                "achievements": 6,
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
