"""Server-side DeepSeek connection; API keys never leave this module in responses."""

import os
from datetime import datetime, timezone
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AiConnection

DEEPSEEK_URL = "https://api.deepseek.com"
MODELS = {"deepseek-flash", "deepseek-v4-pro"}
DEFAULT_MODEL = "deepseek-flash"
KEY_PATH = Path(__file__).resolve().parents[2] / "ai-key" / "fernet.key"


def _supported_model(value: str | None) -> str:
    return value if value in MODELS else DEFAULT_MODEL


def _cipher(create: bool = False) -> Fernet:
    configured = os.getenv("AI_ENCRYPTION_KEY")
    if configured:
        return Fernet(configured.encode())
    path = Path(os.getenv("AI_KEY_FILE", str(KEY_PATH)))
    if create and not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        try:
            descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        except FileExistsError:
            pass
        else:
            with os.fdopen(descriptor, "wb") as handle:
                handle.write(Fernet.generate_key())
    if not path.exists():
        raise ValueError("AI 加密密钥尚未创建")
    return Fernet(path.read_bytes().strip())


def resolve(db: Session, owner_id: int) -> tuple[str, str]:
    row = db.scalar(select(AiConnection).where(AiConnection.owner_id == owner_id))
    # Environment fallback is only for the migrated local owner, never every new account.
    fallback_key = os.getenv("AI_API_KEY", "") if owner_id == 1 else ""
    if row and row.encrypted_key:
        try:
            key = _cipher().decrypt(row.encrypted_key.encode()).decode()
        except (InvalidToken, ValueError) as exc:
            if not fallback_key:
                raise ValueError("AI 密钥无法解密，请重新配置") from exc
        else:
            return key, _supported_model(row.model)
    if fallback_key:
        return fallback_key, _supported_model(row.model if row else os.getenv("AI_MODEL"))
    raise ValueError("请先配置 DeepSeek API Key")


def status(db: Session, owner_id: int) -> dict:
    row = db.scalar(select(AiConnection).where(AiConnection.owner_id == owner_id))
    try:
        resolve(db, owner_id)
        configured = True
    except ValueError:
        configured = False
    return {
        "configured": configured,
        "model": _supported_model(
            row.model if row else os.getenv("AI_MODEL") if owner_id == 1 else None
        ),
        "endpoint": DEEPSEEK_URL,
    }


def save(
    db: Session, api_key: str | None, model: str, clear_key: bool = False, *, owner_id: int
) -> dict:
    if model not in MODELS:
        raise ValueError("不支持的 DeepSeek 模型")
    row = db.scalar(select(AiConnection).where(AiConnection.owner_id == owner_id))
    if row is None:
        row = AiConnection(owner_id=owner_id, encrypted_key="", model=model)
        db.add(row)
    if clear_key:
        row.encrypted_key = ""
    elif api_key:
        key = api_key.strip()
        if len(key) < 8:
            raise ValueError("API Key 格式不正确")
        row.encrypted_key = _cipher(create=True).encrypt(key.encode()).decode()
    row.model = model
    row.updated_at = datetime.now(timezone.utc)
    db.flush()
    return status(db, owner_id)
