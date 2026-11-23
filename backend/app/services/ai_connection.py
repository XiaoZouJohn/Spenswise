"""Per-user DeepSeek credentials, encrypted at rest in the application database."""

import os
from datetime import datetime, timezone
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AiConnection

from . import ai_agreement

DEEPSEEK_URL = "https://api.deepseek.com"
MODELS = {"deepseek-flash", "deepseek-v4-pro"}
DEFAULT_MODEL = "deepseek-flash"


def _model() -> str:
    configured = os.getenv("AI_MODEL", DEFAULT_MODEL)
    return configured if configured in MODELS else DEFAULT_MODEL


def _record(db: Session, owner_id: int) -> AiConnection | None:
    return db.scalar(select(AiConnection).where(AiConnection.owner_id == owner_id))


def _cipher(db: Session) -> Fernet:
    configured = os.getenv("AI_ENCRYPTION_KEY", "").strip()
    if configured:
        return Fernet(configured.encode())
    database = db.get_bind().url.database
    if not database or database == ":memory:":
        raise ValueError("请配置 AI_ENCRYPTION_KEY 后再保存 API 密钥")
    secret_path = Path(
        os.getenv("AI_KEY_FILE") or Path(database).resolve().with_name("ai-connection.key")
    )
    secret_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with secret_path.open("xb") as handle:
            handle.write(Fernet.generate_key())
    except FileExistsError:
        pass
    return Fernet(secret_path.read_bytes().strip())


def save(db: Session, owner_id: int, key: str, model: str) -> dict:
    clean = key.strip()
    if not clean:
        raise ValueError("请输入 DeepSeek API Key")
    if model not in MODELS:
        raise ValueError("模型配置无法识别")
    encrypted = _cipher(db).encrypt(clean.encode()).decode()
    record = _record(db, owner_id)
    if record is None:
        record = AiConnection(owner_id=owner_id)
        db.add(record)
    record.encrypted_key = encrypted
    record.model = model
    record.updated_at = datetime.now(timezone.utc)
    db.commit()
    return status(db, owner_id)


def delete(db: Session, owner_id: int) -> dict:
    # An empty record explicitly disables a bundled/environment default key.
    record = _record(db, owner_id)
    if record is None:
        record = AiConnection(owner_id=owner_id)
        db.add(record)
    record.encrypted_key = ""
    record.model = _model()
    record.updated_at = datetime.now(timezone.utc)
    db.commit()
    return status(db, owner_id)


def resolve(db: Session, owner_id: int) -> tuple[str, str]:
    if not ai_agreement.accepted(db, owner_id):
        raise ValueError("请先阅读并同意 AI 使用协议")
    record = _record(db, owner_id)
    if record is not None:
        if not record.encrypted_key:
            raise ValueError("请先配置 DeepSeek API Key")
        try:
            return _cipher(db).decrypt(record.encrypted_key.encode()).decode(), record.model
        except (InvalidToken, ValueError) as exc:
            raise ValueError("无法读取已保存的 API 密钥，请重新配置") from exc
    key = os.getenv("AI_API_KEY", "").strip()
    if not key:
        raise ValueError("请先配置 DeepSeek API Key")
    return key, _model()


def status(db: Session, owner_id: int) -> dict:
    record = _record(db, owner_id)
    return {
        "configured": (
            bool(record.encrypted_key)
            if record is not None
            else bool(os.getenv("AI_API_KEY", "").strip())
        ),
        "model": record.model if record is not None else _model(),
        "endpoint": DEEPSEEK_URL,
    }
