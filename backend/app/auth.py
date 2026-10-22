"""Password and cookie-session boundary for all private API routes."""

import hashlib
import os
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import get_db
from .models import User, UserSession

COOKIE_NAME = "spendwise_session"
SESSION_DAYS = 14


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def password_hash(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.scrypt(
        password.encode(), salt=salt, n=2**15, r=8, p=1, dklen=32, maxmem=128 * 1024 * 1024
    )
    return f"scrypt$32768$8$1${salt.hex()}${digest.hex()}"


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, n, r, p, salt, expected = encoded.split("$")
        if algorithm != "scrypt":
            return False
        digest = hashlib.scrypt(
            password.encode(),
            salt=bytes.fromhex(salt),
            n=int(n),
            r=int(r),
            p=int(p),
            dklen=32,
            maxmem=128 * 1024 * 1024,
        )
        return secrets.compare_digest(digest, bytes.fromhex(expected))
    except (ValueError, TypeError):
        return False


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def create_session(db: Session, user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    db.add(
        UserSession(
            token_hash=token_hash(token),
            user_id=user_id,
            expires_at=now_utc() + timedelta(days=SESSION_DAYS),
        )
    )
    db.flush()
    return token


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        raise HTTPException(401, detail={"code": "UNAUTHORIZED", "message": "请先登录"})
    session = db.get(UserSession, token_hash(token))
    if session is None:
        raise HTTPException(401, detail={"code": "UNAUTHORIZED", "message": "登录已失效"})
    expires = session.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=timezone.utc)
    if expires <= now_utc():
        db.delete(session)
        db.commit()
        raise HTTPException(401, detail={"code": "UNAUTHORIZED", "message": "登录已过期"})
    user = db.get(User, session.user_id)
    if user is None or user.is_legacy_placeholder:
        raise HTTPException(401, detail={"code": "UNAUTHORIZED", "message": "登录已失效"})
    return user


def normalize_email(email: str) -> str:
    clean = email.strip().lower()
    if len(clean) < 3 or "@" not in clean or clean.startswith("@") or clean.endswith("@"):
        raise HTTPException(422, detail={"code": "INVALID_EMAIL", "message": "邮箱格式无效"})
    return clean


def get_user_by_email(db: Session, email: str) -> User | None:
    return db.scalar(select(User).where(User.email == normalize_email(email)))
