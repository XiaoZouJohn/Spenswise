"""Administrator-managed DeepSeek connection, shared by all users."""

import os

from sqlalchemy.orm import Session

from . import ai_agreement

DEEPSEEK_URL = "https://api.deepseek.com"
MODELS = {"deepseek-flash", "deepseek-v4-pro"}
DEFAULT_MODEL = "deepseek-flash"


def _model() -> str:
    configured = os.getenv("AI_MODEL", DEFAULT_MODEL)
    return configured if configured in MODELS else DEFAULT_MODEL


def resolve(db: Session, owner_id: int) -> tuple[str, str]:
    if not ai_agreement.accepted(db, owner_id):
        raise ValueError("请先阅读并同意 AI 使用协议")
    key = os.getenv("AI_API_KEY", "").strip()
    if not key:
        raise ValueError("AI 服务暂未开放")
    return key, _model()


def status(db: Session, owner_id: int) -> dict:
    return {
        "configured": bool(os.getenv("AI_API_KEY", "").strip()),
        "model": _model(),
        "endpoint": DEEPSEEK_URL,
    }
