"""Run locally after alembic upgrade head; prints a one-use claim code once."""

import secrets

from app.auth import token_hash
from app.db import SessionLocal
from app.models import LegacyClaim


def main() -> None:
    code = secrets.token_urlsafe(32)
    with SessionLocal.begin() as db:
        row = db.get(LegacyClaim, 1)
        if row is None or row.claimed_at is not None:
            raise SystemExit("原有数据已认领或尚未执行 0005 迁移")
        row.code_hash = token_hash(code)
    print("一次性原数据认领码（请仅复制到自己的登录会话）：")
    print(code)


if __name__ == "__main__":
    main()
