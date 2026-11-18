import os

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .auth import current_user
from .db import get_db
from .models import ConsumptionEvent, StoryEdition, StoryPart, User
from .schemas import BatchReviewIn, DraftIn, EventIn, LifeLogIn, LifeLogOut, StoryGenerateIn
from .services import village_life as life
from .services import village_story

router = APIRouter(prefix="/api/village", tags=["village life"])
MONTH = r"^\d{4}-(0[1-9]|1[0-2])$"


def execute(db: Session, operation):
    try:
        result = operation()
        db.commit()
        return result
    except LookupError as error:
        db.rollback()
        raise HTTPException(404, str(error)) from error
    except PermissionError as error:
        db.rollback()
        raise HTTPException(403, str(error)) from error
    except (ValueError, IntegrityError) as error:
        db.rollback()
        raise HTTPException(409, "数据已变化或输入无效，请重新读取后确认") from error


@router.get("/logs", response_model=list[LifeLogOut])
def life_logs(
    month: str | None = Query(default=None, pattern=MONTH),
    transaction_id: int | None = None,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    return execute(db, lambda: life.logs(db, user.id, month, transaction_id))


@router.get("/logs/{log_id}", response_model=LifeLogOut)
def life_log(log_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)):
    return execute(db, lambda: life.log_out(db, life.get_log(db, user.id, log_id)))


@router.post("/logs", response_model=LifeLogOut)
def create_life_log(
    value: LifeLogIn, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    return execute(db, lambda: life.save_log(db, user.id, value.model_dump()))


@router.put("/logs/{log_id}", response_model=LifeLogOut)
def update_life_log(
    log_id: str, value: LifeLogIn, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    return execute(db, lambda: life.save_log(db, user.id, value.model_dump(), log_id))


@router.delete("/logs/{log_id}")
def delete_life_log(
    log_id: str,
    revision: int = Query(ge=1),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    return execute(db, lambda: life.delete_log(db, user.id, log_id, revision))


@router.get("/events")
def consumption_events(
    month: str = Query(pattern=MONTH),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    return execute(db, lambda: life.events(db, user.id, month))


@router.get("/events/{transaction_id}")
def consumption_event(
    transaction_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    def read():
        tx = life.owned_transactions(db, user.id, [transaction_id])[0]
        row = db.scalar(
            select(ConsumptionEvent).where(
                ConsumptionEvent.owner_id == user.id, ConsumptionEvent.transaction_id == tx.id
            )
        )
        return (
            life.event_out(db, user.id, row)
            if row
            else {
                "transaction_id": tx.id,
                "revision": 0,
                "purpose": "",
                "feeling": "",
                "note": "",
                "deferred": False,
                "logs": life.logs(db, user.id, transaction_id=tx.id),
            }
        )

    return execute(db, read)


@router.put("/events/{transaction_id}")
def update_consumption_event(
    transaction_id: int,
    value: EventIn,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    return execute(db, lambda: life.save_event(db, user.id, transaction_id, value.model_dump()))


@router.post("/batch-review")
def review_transactions(
    value: BatchReviewIn, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    return execute(db, lambda: life.batch_review(db, user.id, value.model_dump()))


@router.get("/state")
def village_state(
    month: str = Query(pattern=MONTH),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    return execute(db, lambda: life.state(db, user.id, month))


@router.get("/market")
def village_market(
    month: str = Query(pattern=MONTH),
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    return execute(db, lambda: life.market(db, user.id, month))


@router.get("/drafts/{resource_type}/{resource_id}")
def workspace_draft(
    resource_type: str,
    resource_id: str,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    return execute(db, lambda: life.draft(db, user.id, resource_type, resource_id))


@router.put("/drafts/{resource_type}/{resource_id}")
def save_workspace_draft(
    resource_type: str,
    resource_id: str,
    value: DraftIn,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    if value.expected_owner_id is not None and value.expected_owner_id != user.id:
        raise HTTPException(409, "登录账号已变化，拒绝同步旧窗口草稿")
    return execute(
        db, lambda: life.save_draft(db, user.id, resource_type, resource_id, value.model_dump())
    )


@router.delete("/drafts/{resource_type}/{resource_id}")
def clear_workspace_draft(
    resource_type: str,
    resource_id: str,
    revision: int = Query(ge=0),
    expected_owner_id: int | None = None,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    if expected_owner_id is not None and expected_owner_id != user.id:
        raise HTTPException(409, "登录账号已变化，拒绝清理旧窗口草稿")
    return execute(db, lambda: life.clear_draft(db, user.id, resource_type, resource_id, revision))


@router.get("/story/{month}")
def monthly_story(
    month: str,
    edition_id: str | None = None,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    return execute(db, lambda: village_story.read(db, user.id, month, edition_id))


@router.post("/story/{month}")
def generate_monthly_story(
    month: str,
    value: StoryGenerateIn,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    result = execute(
        db, lambda: village_story.queue(db, user.id, month, value.use_logs, value.force)
    )
    if result["status"] == "pending":
        from .tasks import story_task

        try:
            if os.getenv("CELERY_ALWAYS_EAGER") == "1":
                village_story.generate(db, result["id"])
            else:
                story_task.apply_async(args=[result["id"]], retry=False)
        except Exception:
            row = db.get(StoryEdition, result["id"])
            if row and row.owner_id == user.id:
                row.status = "failed"
                row.error_message = "无法提交任务，请检查队列服务后重试"
                db.commit()
    db.expire_all()
    row = db.get(StoryEdition, result["id"])
    if row is None:
        raise HTTPException(404, "任务不存在")
    return village_story.edition_out(db, user.id, row)


@router.get("/story-tasks/{task_id}")
def story_task_status(
    task_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    row = db.scalar(
        select(StoryEdition).where(StoryEdition.id == task_id, StoryEdition.owner_id == user.id)
    )
    if row is None:
        raise HTTPException(404, "任务不存在")
    return village_story.edition_out(db, user.id, row)


@router.get("/transaction-story/{transaction_id}")
def transaction_story(
    transaction_id: int, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    execute(db, lambda: life.owned_transactions(db, user.id, [transaction_id]))
    matches = []
    for part in db.scalars(select(StoryPart).where(StoryPart.owner_id == user.id)):
        if any(
            ref.get("type") == "transaction" and str(ref.get("id")) == str(transaction_id)
            for ref in part.sources
        ):
            edition = db.get(StoryEdition, part.edition_id)
            if edition is None:
                continue
            matches.append(
                {
                    "edition_id": part.edition_id,
                    "chapter": part.chapter,
                    "month": edition.month,
                    "title": part.title,
                }
            )
    return matches[-20:]
