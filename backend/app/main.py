import os
import uuid
from datetime import date, datetime
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import Depends, FastAPI, File, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from .auth import current_user
from .db import get_db
from .models import (
    BackgroundTask,
    ImportJob,
    Scenario,
    Transaction,
    UploadToken,
    User,
)
from .routes_agent import router as agent_router
from .routes_auth import router as auth_router
from .routes_family import router as family_router
from .routes_review import router as review_router
from .routes_village import router as village_router
from .schemas import (
    AiCategoryApplyIn,
    AiConnectionIn,
    AiConnectionOut,
    AiStatusOut,
    BatchCategory,
    BudgetLimitsIn,
    BudgetStatus,
    ChatConversationDetail,
    ChatConversationOut,
    ChatLedgerConsentIn,
    ChatLedgerConsentOut,
    ChatRequest,
    ImportConfirm,
    OverviewOut,
    Page,
    SavedScenario,
    SavedScenarioResult,
    ScenarioIn,
    ScenarioResult,
    SettingsIn,
    SettingsOut,
    TransactionIn,
    TransactionOut,
)
from .services import (
    ai,
    ai_chat,
    ai_connection,
    ai_ledger_consent,
    budget,
    forecast,
    imports,
    ledger,
)
from .tasks import category_task, celery_app, import_task

app = FastAPI(title="SpendWise API", version="3.0.0")
ALLOWED_ORIGINS = os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(
    ","
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(auth_router)
app.include_router(family_router)
app.include_router(agent_router)
app.include_router(review_router)
app.include_router(village_router)


@app.middleware("http")
async def check_origin(request: Request, call_next):
    origin = request.headers.get("origin")
    if (
        request.method in {"POST", "PUT", "PATCH", "DELETE"}
        and origin
        and origin not in ALLOWED_ORIGINS
    ):
        return JSONResponse(
            status_code=403,
            content={"detail": {"code": "ORIGIN_FORBIDDEN", "message": "请求来源不受信任"}},
        )
    return await call_next(request)


def local_today() -> date:
    return datetime.now(ZoneInfo("Asia/Shanghai")).date()


@app.get("/api/health")
def health() -> dict:
    result = {"status": "ok"}
    if instance := os.getenv("SPENDWISE_INSTANCE"):
        result["instance"] = instance
    return result


@app.get("/api/settings", response_model=SettingsOut)
def get_settings(user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    return budget.get_settings(db, user.id)


@app.put("/api/settings", response_model=SettingsOut)
def put_settings(
    value: SettingsIn, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> dict:
    result = budget.save_settings(db, value.model_dump(), user.id)
    db.commit()
    return result


@app.get("/api/overview", response_model=OverviewOut)
def overview(
    as_of: date | None = None, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> dict:
    result = budget.summary(db, as_of or local_today(), user.id)
    result["data_version"] = ledger.version(db, user.id)
    return result


@app.get("/api/budget/status", response_model=BudgetStatus)
def get_budget_status(
    as_of: date | None = None, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> dict:
    return budget.budget_status(db, as_of or local_today(), owner_id=user.id)


@app.post("/api/budget/preview", response_model=BudgetStatus)
def preview_budget(
    value: BudgetLimitsIn, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> dict:
    return budget.budget_status(db, local_today(), value.model_dump(), owner_id=user.id)


@app.get("/api/transactions", response_model=Page)
def transactions(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
    category: str | None = None,
    tx_type: Literal["expense", "income", "refund", "transfer"] | None = None,
    merchant: str | None = Query(default=None, max_length=255),
    date_from: date | None = None,
    date_to: date | None = None,
    review: bool = False,
    account_key: str | None = None,
    ids: str | None = None,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> Page:
    selected_ids = None
    if ids:
        try:
            selected_ids = [int(value) for value in ids.split(",")]
        except ValueError as exc:
            raise HTTPException(
                422, detail={"code": "INVALID_IDS", "message": "账单编号无效"}
            ) from exc
        if len(selected_ids) > 200:
            raise HTTPException(422, detail={"code": "TOO_MANY_IDS", "message": "最多筛选 200 笔"})
    try:
        items, total, totals = ledger.list_transactions(
            db,
            owner_id=user.id,
            page=page,
            page_size=page_size,
            category=category,
            tx_type=tx_type,
            merchant=merchant,
            date_from=date_from,
            date_to=date_to,
            review=review,
            account_key=account_key,
            ids=selected_ids,
        )
    except ValueError as exc:
        raise HTTPException(422, detail={"code": "INVALID_FILTER", "message": str(exc)}) from exc
    return Page(
        items=[TransactionOut.model_validate(item) for item in items],
        total=total,
        page=page,
        page_size=page_size,
        expense_cents=totals["expense_cents"],
        income_cents=totals["income_cents"],
        category_spend=totals["category_spend"],
        net_flow_cents=totals["net_flow_cents"],
    )


@app.post("/api/transactions", response_model=TransactionOut)
def create_transaction(
    item: TransactionIn, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> TransactionOut:
    try:
        row, inserted = ledger.add_transaction(db, item, owner_id=user.id)
    except ValueError as exc:
        db.rollback()
        raise HTTPException(422, str(exc)) from exc
    db.commit()
    if not inserted:
        raise HTTPException(
            409, detail={"code": "DUPLICATE", "message": "账单已存在", "id": row.id}
        )
    return TransactionOut.model_validate(row)


@app.delete("/api/transactions/{transaction_id}")
def delete_transaction(
    transaction_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> dict:
    try:
        deleted = ledger.delete_transaction(db, transaction_id, user.id)
    except ValueError as exc:
        raise HTTPException(
            409, detail={"code": "TRANSACTION_LINKED", "message": str(exc)}
        ) from exc
    if not deleted:
        raise HTTPException(404, detail={"code": "NOT_FOUND", "message": "账单不存在"})
    db.commit()
    return {"deleted": transaction_id}


@app.delete("/api/transactions")
def delete_all_transactions(
    user: User = Depends(current_user), db: Session = Depends(get_db)
) -> dict:
    try:
        deleted = ledger.delete_all_transactions(db, user.id)
    except ValueError as exc:
        raise HTTPException(
            409, detail={"code": "TRANSACTION_LINKED", "message": str(exc)}
        ) from exc
    db.commit()
    return {"deleted": deleted}


@app.post("/api/transactions/batch-category")
def update_categories(
    value: BatchCategory, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> dict:
    if len(value.ids) > 100:
        task = category_task.delay(value.ids, value.category, user.id, value.create_rule)
        db.add(BackgroundTask(id=task.id, owner_id=user.id, kind="category"))
        db.commit()
        return {"status": "queued", "task_id": task.id}
    before = ledger.batch_category(db, value.ids, value.category, value.create_rule, user.id)
    db.commit()
    return {"status": "completed", "before": before}


@app.post("/api/transactions/undo-category")
def undo_categories(
    value: list[dict], user: User = Depends(current_user), db: Session = Depends(get_db)
) -> dict:
    restored = 0
    for item in value:
        row = db.get(Transaction, item.get("id"))
        if row and row.owner_id == user.id:
            row.category = item["category"]
            if "confidence" in item:
                row.confidence = int(item["confidence"])
            if "classification_reason" in item:
                row.classification_reason = str(item["classification_reason"])
            restored += 1
    db.commit()
    return {"restored": restored}


@app.post("/api/simulate", response_model=ScenarioResult)
def simulate(
    value: ScenarioIn, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> dict:
    try:
        return forecast.simulate(db, value, owner_id=user.id)
    except ValueError as exc:
        raise HTTPException(422, detail={"code": "INVALID_SCENARIO", "message": str(exc)}) from exc


@app.get("/api/scenarios", response_model=list[SavedScenario])
def scenarios(user: User = Depends(current_user), db: Session = Depends(get_db)) -> list[dict]:
    return [
        {
            "id": x.id,
            "name": x.name,
            "input": x.input,
            "result": x.result,
            "data_version": x.data_version,
        }
        for x in db.scalars(
            select(Scenario)
            .where(Scenario.owner_id == user.id)
            .order_by(Scenario.id.desc())
            .limit(30)
        )
    ]


@app.post("/api/scenarios", response_model=SavedScenarioResult)
def save_scenario(
    value: ScenarioIn, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> dict:
    result = forecast.simulate(db, value, owner_id=user.id)
    row = Scenario(
        owner_id=user.id,
        name=value.name,
        input=value.model_dump(mode="json"),
        result=result,
        data_version=result["data_version"],
    )
    db.add(row)
    db.commit()
    return {"id": row.id, "result": result}


@app.post("/api/import/preview")
async def preview_import(
    file: UploadFile = File(...), user: User = Depends(current_user), db: Session = Depends(get_db)
) -> dict:
    data = await file.read()
    if len(data) > 15_000_000:
        raise HTTPException(413, detail={"code": "FILE_TOO_LARGE", "message": "文件不能超过 15 MB"})
    try:
        result = imports.preview(file.filename or "", data)
    except (ValueError, UnicodeError) as exc:
        raise HTTPException(422, detail={"code": "INVALID_IMPORT", "message": str(exc)}) from exc
    token, digest = imports.store_upload(file.filename or "", data)
    db.add(UploadToken(id=token, owner_id=user.id))
    db.commit()
    return {**result, "token": token, "sha256": digest}


@app.post("/api/import/confirm")
def confirm_import(
    value: ImportConfirm, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> dict:
    try:
        uuid.UUID(value.token)
    except ValueError as exc:
        raise HTTPException(
            422, detail={"code": "INVALID_TOKEN", "message": "导入令牌无效"}
        ) from exc
    upload = db.get(UploadToken, value.token)
    if upload is None or upload.owner_id != user.id:
        raise HTTPException(404, detail={"code": "UPLOAD_NOT_FOUND", "message": "导入预览已失效"})
    path = imports.UPLOAD_DIR / value.token
    name_path = imports.UPLOAD_DIR / f"{value.token}.name"
    if not path.is_file() or not name_path.is_file():
        raise HTTPException(404, detail={"code": "UPLOAD_NOT_FOUND", "message": "导入预览已失效"})
    data = path.read_bytes()
    filename = name_path.read_text(encoding="utf-8")
    check = imports.preview(filename, data, value.mapping)
    if check["errors"]:
        raise HTTPException(
            422,
            detail={"code": "INVALID_ROWS", "message": "请先处理异常行", "errors": check["errors"]},
        )
    import hashlib

    digest = hashlib.sha256(data).hexdigest()
    mapping_digest = hashlib.sha256(value.mapping.model_dump_json().encode()).hexdigest()
    existing = db.scalar(
        select(ImportJob).where(
            ImportJob.owner_id == user.id,
            ImportJob.content_sha256 == digest,
            ImportJob.mapping_sha256 == mapping_digest,
        )
    )
    if existing:
        # Repeating the exact same confirmation request should stay idempotent.
        # A fresh preview receives a new token, however, and must be allowed to
        # rescan the file. Transaction fingerprints still prevent duplicates,
        # while rows deleted from the ledger can be restored by re-importing.
        if existing.id == value.token or (
            os.getenv("CELERY_ALWAYS_EAGER") != "1" and existing.status in {"pending", "running"}
        ):
            return {
                "id": existing.id,
                "status": existing.status,
                "inserted": existing.inserted,
                "duplicates": existing.duplicates,
            }
        db.delete(existing)
        db.flush()
    job = ImportJob(
        id=value.token,
        owner_id=user.id,
        status="pending",
        filename=filename,
        content_sha256=digest,
        mapping_sha256=mapping_digest,
        mapping=value.mapping.model_dump(),
        errors=[],
    )
    db.add(job)
    db.commit()
    if os.getenv("CELERY_ALWAYS_EAGER") == "1":
        imports.process_import(db, job, data)
    else:
        try:
            import_task.apply_async(args=[job.id], retry=False)
        except Exception:
            job.status = "failed"
            job.error_message = "导入任务未能送达队列，请稍后重试；账单文件仍保留。"
            db.commit()
    return {
        "id": job.id,
        "status": job.status,
        "inserted": job.inserted,
        "duplicates": job.duplicates,
    }


@app.get("/api/import/jobs/{job_id}")
def import_status(
    job_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> dict:
    job = db.get(ImportJob, job_id)
    if not job or job.owner_id != user.id:
        raise HTTPException(404, detail={"code": "NOT_FOUND", "message": "任务不存在"})
    return {
        "id": job.id,
        "status": job.status,
        "inserted": job.inserted,
        "duplicates": job.duplicates,
        "errors": job.errors,
        "error_message": job.error_message,
    }


@app.get("/api/tasks/{task_id}")
def task_status(
    task_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> dict:
    try:
        uuid.UUID(task_id)
    except ValueError as exc:
        raise HTTPException(
            422, detail={"code": "INVALID_TASK_ID", "message": "任务编号无效"}
        ) from exc
    owned = db.get(BackgroundTask, task_id)
    if owned is None or owned.owner_id != user.id:
        raise HTTPException(404, detail={"code": "NOT_FOUND", "message": "任务不存在"})
    task = celery_app.AsyncResult(task_id)
    return {
        "id": task_id,
        "status": task.state.lower(),
        "result": task.result if task.successful() else None,
        "error_message": str(task.result) if task.failed() else "",
    }


@app.get("/api/ai/status", response_model=AiStatusOut)
def ai_status(user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    return {
        "consent": budget.get_settings(db, user.id)["ai_consent"],
        **ai_connection.status(db, user.id),
    }


@app.get("/api/ai/connection", response_model=AiConnectionOut)
def get_ai_connection(user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    return ai_connection.status(db, user.id)


@app.put("/api/ai/connection", response_model=AiConnectionOut)
def put_ai_connection(
    value: AiConnectionIn, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> dict:
    try:
        result = ai_connection.save(
            db, value.api_key, value.model, value.clear_key, owner_id=user.id
        )
        db.commit()
        return result
    except ValueError as exc:
        db.rollback()
        raise HTTPException(
            422, detail={"code": "INVALID_AI_CONNECTION", "message": str(exc)}
        ) from exc


@app.get("/api/ai/conversations", response_model=list[ChatConversationOut])
def list_ai_conversations(
    user: User = Depends(current_user), db: Session = Depends(get_db)
) -> list[dict]:
    return ai_chat.list_conversations(db, user.id)


@app.get("/api/ai/chat/ledger-consent", response_model=ChatLedgerConsentOut)
def get_chat_ledger_consent(
    user: User = Depends(current_user), db: Session = Depends(get_db)
) -> dict:
    return ai_chat.ledger_consent_status(db, user.id)


@app.put("/api/ai/chat/ledger-consent", response_model=ChatLedgerConsentOut)
def put_chat_ledger_consent(
    value: ChatLedgerConsentIn, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> dict:
    ai_ledger_consent.set_enabled(db, user.id, value.enabled)
    return ai_chat.ledger_consent_status(db, user.id)


@app.get("/api/ai/conversations/{conversation_id}", response_model=ChatConversationDetail)
def get_ai_conversation(
    conversation_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> dict:
    result = ai_chat.get_conversation(db, conversation_id, user.id)
    if result is None:
        raise HTTPException(404, detail={"code": "NOT_FOUND", "message": "对话不存在"})
    return result


@app.delete("/api/ai/conversations/{conversation_id}")
def delete_ai_conversation(
    conversation_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> dict:
    if not ai_chat.delete_conversation(db, conversation_id, user.id):
        raise HTTPException(404, detail={"code": "NOT_FOUND", "message": "对话不存在"})
    db.commit()
    return {"deleted": True}


@app.post("/api/ai/chat/stream")
def stream_ai_chat(
    value: ChatRequest, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> StreamingResponse:
    try:
        prepared = ai_chat.prepare(
            db, value.conversation_id, value.message, value.thinking, user.id
        )
    except ai_chat.InvalidChatMessage as exc:
        raise HTTPException(
            422, detail={"code": "INVALID_CHAT_MESSAGE", "message": str(exc)}
        ) from exc
    except LookupError as exc:
        raise HTTPException(404, detail={"code": "NOT_FOUND", "message": str(exc)}) from exc
    except PermissionError as exc:
        raise HTTPException(
            409, detail={"code": "LEDGER_CONSENT_REQUIRED", "message": str(exc)}
        ) from exc
    except ValueError as exc:
        raise HTTPException(409, detail={"code": "AI_NOT_CONFIGURED", "message": str(exc)}) from exc
    return StreamingResponse(
        ai_chat.stream_reply(prepared),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/api/ai/explain")
def ai_explain(
    value: ScenarioIn, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> dict:
    if not budget.get_settings(db, user.id)["ai_consent"]:
        raise HTTPException(
            403, detail={"code": "AI_CONSENT_REQUIRED", "message": "请先授权 AI 使用数据"}
        )
    result = forecast.simulate(db, value, owner_id=user.id)
    # No financial computation is delegated to an LLM. Local explanation works offline.
    verdict = (
        "目前无可行的削减方案"
        if not result["optimization"]["feasible"]
        else "方案满足保留余额"
        if result["required_saving_cents"] == 0
        else "可通过调整弹性类别满足保留余额"
    )
    return {"text": verdict, "calculation": result, "source": "local-rules"}


@app.post("/api/ai/test")
def test_ai(user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    if not ai_connection.status(db, user.id)["configured"]:
        raise HTTPException(
            409, detail={"code": "AI_NOT_CONFIGURED", "message": "请先配置 DeepSeek API Key"}
        )
    try:
        answer = ai.ask([{"role": "user", "content": "只回复：连接成功"}], db, user.id)
        return {"ok": True, "message": "连接成功", "response": answer[:100]}
    except Exception as exc:
        raise HTTPException(502, detail={"code": "AI_UNAVAILABLE", "message": str(exc)}) from exc


@app.post("/api/ai/review-transactions")
def review_ai(
    ids: list[int], user: User = Depends(current_user), db: Session = Depends(get_db)
) -> dict:
    try:
        return {"suggestions": ai.review(db, ids, user.id)}
    except ValueError as exc:
        raise HTTPException(403, detail={"code": "AI_UNAVAILABLE", "message": str(exc)}) from exc


@app.post("/api/ai/review-all-transactions")
def review_all_ai(user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    try:
        return ai.review_all(db, user.id)
    except ValueError as exc:
        raise HTTPException(403, detail={"code": "AI_UNAVAILABLE", "message": str(exc)}) from exc


@app.post("/api/ai/review-pending-transactions")
def review_pending_ai(user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    try:
        return ai.review_pending(db, user.id)
    except ValueError as exc:
        raise HTTPException(403, detail={"code": "AI_UNAVAILABLE", "message": str(exc)}) from exc


@app.post("/api/ai/apply-transaction-categories")
def apply_ai_categories(
    value: AiCategoryApplyIn,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
) -> dict:
    try:
        result = ai.apply_suggestions(
            db, [item.model_dump() for item in value.suggestions], user.id
        )
        db.commit()
        return result
    except ValueError as exc:
        raise HTTPException(
            422, detail={"code": "INVALID_AI_CATEGORIES", "message": str(exc)}
        ) from exc
