import os

from celery import Celery
from sqlalchemy import select

from .db import SessionLocal
from .models import ImportJob
from .services.imports import UPLOAD_DIR, process_import
from .services.ledger import batch_category

celery_app = Celery(
    "spendwise",
    broker=os.getenv("REDIS_URL", "redis://localhost:6379/0"),
    backend=os.getenv("REDIS_URL", "redis://localhost:6379/0"),
)
celery_app.conf.update(
    broker_connection_timeout=3,
    broker_transport_options={"socket_connect_timeout": 3, "socket_timeout": 3},
    task_track_started=True,
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
)


@celery_app.task(name="spendwise.story", soft_time_limit=90, time_limit=120)
def story_task(task_id: str) -> None:
    from .services.village_story import generate

    with SessionLocal() as db:
        generate(db, task_id)


@celery_app.task(name="spendwise.import", bind=True)
def import_task(self, job_id: str) -> None:
    with SessionLocal() as db:
        job = db.scalar(select(ImportJob).where(ImportJob.id == job_id).with_for_update())
        if job is None:
            # Account deletion cancels queued imports by removing their job.
            return
        if job.status != "pending":
            return
        try:
            process_import(db, job, (UPLOAD_DIR / job_id).read_bytes())
        except Exception as exc:
            db.rollback()
            job = db.get(ImportJob, job_id)
            if job is not None:
                job.status = "failed"
                job.error_message = str(exc)
                db.commit()
            raise


@celery_app.task(name="spendwise.batch_category")
def category_task(ids: list[int], category: str, owner_id: int, create_rule: bool = False) -> int:
    with SessionLocal.begin() as db:
        return len(batch_category(db, ids, category, create_rule, owner_id))
