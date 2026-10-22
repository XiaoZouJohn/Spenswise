"""Registration, private sessions, and explicit one-time legacy ownership transfer."""

import re
import secrets
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .auth import (
    COOKIE_NAME,
    SESSION_DAYS,
    create_session,
    current_user,
    get_user_by_email,
    normalize_email,
    password_hash,
    token_hash,
    verify_password,
)
from .db import get_db
from .models import (
    AiConnection,
    AssetSnapshot,
    CategoryBudget,
    ChatConversation,
    ChatMessage,
    HouseholdMember,
    HouseholdProposal,
    ImportJob,
    LegacyClaim,
    MerchantRule,
    ProposalComment,
    Scenario,
    Setting,
    Transaction,
    User,
    UserSession,
)
from .schemas import (
    AccountDeleteIn,
    AccountDeleteOut,
    AuthCredentials,
    DeviceSessionOut,
    LegacyClaimIn,
    PasswordChangeIn,
    RegisterIn,
    SessionOut,
    UserOut,
    UserUpdate,
)
from .services import account, households

router = APIRouter(prefix="/api")


def _profile(db: Session, user: User) -> dict:
    claim = db.get(LegacyClaim, 1)
    return {
        "user": UserOut(id=user.id, email=user.email, display_name=user.display_name),
        "family": households.family_summary(db, user.id),
        "claim_available": claim is not None and claim.claimed_at is None,
    }


def _set_cookie(response: Response, request: Request, token: str) -> None:
    response.set_cookie(
        COOKIE_NAME,
        token,
        httponly=True,
        secure=request.url.scheme == "https",
        samesite="lax",
        path="/api",
        max_age=SESSION_DAYS * 86400,
    )


@router.post("/auth/register", response_model=SessionOut)
def register(
    value: RegisterIn, request: Request, response: Response, db: Session = Depends(get_db)
) -> dict:
    email = normalize_email(value.email)
    if get_user_by_email(db, email):
        raise HTTPException(409, detail={"code": "EMAIL_EXISTS", "message": "邮箱已注册"})
    user = User(
        email=email,
        display_name=value.display_name.strip(),
        password_hash=password_hash(value.password),
    )
    db.add(user)
    try:
        db.flush()
        token = create_session(db, user.id)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, detail={"code": "EMAIL_EXISTS", "message": "邮箱已注册"}) from exc
    _set_cookie(response, request, token)
    return _profile(db, user)


@router.post("/auth/login", response_model=SessionOut)
def login(
    value: AuthCredentials, request: Request, response: Response, db: Session = Depends(get_db)
) -> dict:
    user = get_user_by_email(db, value.email)
    if (
        user is None
        or user.is_legacy_placeholder
        or not verify_password(value.password, user.password_hash)
    ):
        raise HTTPException(
            401, detail={"code": "INVALID_CREDENTIALS", "message": "邮箱或密码错误"}
        )
    token = create_session(db, user.id)
    db.commit()
    _set_cookie(response, request, token)
    return _profile(db, user)


@router.get("/auth/me", response_model=SessionOut)
def me(user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    return _profile(db, user)


@router.post("/auth/logout")
def logout(request: Request, response: Response, db: Session = Depends(get_db)) -> dict:
    token = request.cookies.get(COOKIE_NAME)
    if token:
        row = db.get(UserSession, token_hash(token))
        if row:
            db.delete(row)
            db.commit()
    response.delete_cookie(COOKIE_NAME, path="/api")
    return {"ok": True}


@router.get("/users/me", response_model=UserOut)
def user_profile(user: User = Depends(current_user)) -> UserOut:
    return UserOut(id=user.id, email=user.email, display_name=user.display_name)


@router.put("/users/me", response_model=UserOut)
def update_profile(
    value: UserUpdate, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> UserOut:
    user.display_name = value.display_name.strip()
    db.commit()
    return UserOut(id=user.id, email=user.email, display_name=user.display_name)


@router.delete("/users/me", response_model=AccountDeleteOut)
def delete_my_account(
    value: AccountDeleteIn,
    response: Response,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> AccountDeleteOut:
    upload_ids = account.delete_account(db, user, value.password)
    db.commit()
    response.delete_cookie(COOKIE_NAME, path="/api")
    account.delete_upload_files(upload_ids)
    return AccountDeleteOut(deleted=True)


@router.post("/users/me/password")
def change_password(
    value: PasswordChangeIn,
    request: Request,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict:
    if not verify_password(value.current_password, user.password_hash):
        raise HTTPException(403, detail={"code": "INVALID_PASSWORD", "message": "当前密码错误"})
    user.password_hash = password_hash(value.new_password)
    current_hash = token_hash(request.cookies[COOKIE_NAME])
    for session in db.scalars(select(UserSession).where(UserSession.user_id == user.id)):
        if session.token_hash != current_hash:
            db.delete(session)
    db.commit()
    return {"changed": True}


@router.get("/auth/sessions", response_model=list[DeviceSessionOut])
def sessions(
    request: Request, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> list[dict]:
    current_hash = token_hash(request.cookies[COOKIE_NAME])
    rows = db.scalars(
        select(UserSession)
        .where(UserSession.user_id == user.id)
        .order_by(UserSession.created_at.desc())
    ).all()
    return [
        {
            "id": row.token_hash[:20],
            "current": row.token_hash == current_hash,
            "created_at": row.created_at,
            "expires_at": row.expires_at,
        }
        for row in rows
    ]


@router.delete("/auth/sessions/{session_id}")
def revoke_session(
    session_id: str,
    request: Request,
    response: Response,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict:
    if not re.fullmatch(r"[0-9a-f]{20}", session_id):
        raise HTTPException(422, detail={"code": "INVALID_SESSION_ID", "message": "会话编号无效"})
    rows = db.scalars(
        select(UserSession).where(
            UserSession.user_id == user.id, UserSession.token_hash.like(f"{session_id}%")
        )
    ).all()
    if len(rows) != 1:
        raise HTTPException(404, detail={"code": "SESSION_NOT_FOUND", "message": "会话不存在"})
    is_current = rows[0].token_hash == token_hash(request.cookies[COOKIE_NAME])
    db.delete(rows[0])
    db.commit()
    if is_current:
        response.delete_cookie(COOKIE_NAME, path="/api")
    return {"revoked": True}


@router.get("/users/me/export")
def export_my_data(
    user: User = Depends(current_user), db: Session = Depends(get_db)
) -> JSONResponse:
    tables: dict[str, Any] = {
        "transactions": Transaction,
        "settings": Setting,
        "category_budgets": CategoryBudget,
        "merchant_rules": MerchantRule,
        "scenarios": Scenario,
        "import_jobs": ImportJob,
        "chat_conversations": ChatConversation,
        "asset_snapshots": AssetSnapshot,
    }
    payload: dict[str, Any] = {
        "user": {"id": user.id, "email": user.email, "display_name": user.display_name},
        "data": {},
    }
    for name, table in tables.items():
        rows = db.scalars(select(table).where(table.owner_id == user.id)).all()
        payload["data"][name] = [
            {column.key: getattr(row, column.key) for column in table.__table__.columns}
            for row in rows
        ]
    conversations = [row["id"] for row in payload["data"]["chat_conversations"]]
    messages = db.scalars(
        select(ChatMessage).where(ChatMessage.conversation_id.in_(conversations))
    ).all()
    payload["data"]["chat_messages"] = [
        {column.key: getattr(row, column.key) for column in ChatMessage.__table__.columns}
        for row in messages
    ]
    membership = db.get(HouseholdMember, user.id)
    payload["data"]["household_membership"] = (
        {
            column.key: getattr(membership, column.key)
            for column in HouseholdMember.__table__.columns
        }
        if membership is not None
        else None
    )
    for name, table in (
        ("authored_household_proposals", HouseholdProposal),
        ("authored_proposal_comments", ProposalComment),
    ):
        rows = db.scalars(select(table).where(table.author_id == user.id)).all()
        payload["data"][name] = [
            {column.key: getattr(row, column.key) for column in table.__table__.columns}
            for row in rows
        ]
    return JSONResponse(
        content=jsonable_encoder(payload),
        headers={"Content-Disposition": 'attachment; filename="spendwise-my-data.json"'},
    )


@router.post("/auth/claim-legacy")
def claim_legacy(
    value: LegacyClaimIn, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> dict:
    claim = db.scalar(select(LegacyClaim).where(LegacyClaim.id == 1).with_for_update())
    if claim is None or claim.claimed_at is not None or not claim.code_hash:
        raise HTTPException(
            409, detail={"code": "CLAIM_UNAVAILABLE", "message": "原有数据不可认领"}
        )
    if not secrets.compare_digest(claim.code_hash, token_hash(value.code)):
        raise HTTPException(403, detail={"code": "INVALID_CLAIM_CODE", "message": "认领码无效"})
    private_tables: list[Any] = [
        Transaction,
        Setting,
        CategoryBudget,
        MerchantRule,
        Scenario,
        ImportJob,
        AiConnection,
        ChatConversation,
        AssetSnapshot,
    ]
    if any(
        db.scalar(select(table).where(table.owner_id == user.id).limit(1))
        for table in private_tables
    ):
        raise HTTPException(
            409, detail={"code": "ACCOUNT_NOT_EMPTY", "message": "请用新注册的空账号认领"}
        )
    for table in private_tables:
        db.execute(update(table).where(table.owner_id == 1).values(owner_id=user.id))
    claim.code_hash = ""
    claim.claimed_at = datetime.now(timezone.utc)
    db.commit()
    return {"claimed": True}
