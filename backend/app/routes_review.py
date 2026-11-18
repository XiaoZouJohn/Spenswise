from fastapi import APIRouter, Depends, HTTPException, Path
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .auth import current_user
from .db import get_db
from .models import User
from .schemas import MonthlyReviewIn, MonthlyReviewOut
from .services import monthly_review

router = APIRouter(prefix="/api/monthly-reviews", tags=["monthly reviews"])
Month = Path(pattern=r"^\d{4}-(0[1-9]|1[0-2])$")


@router.get("/{month}", response_model=MonthlyReviewOut)
def get_monthly_review(
    month: str = Month, user: User = Depends(current_user), db: Session = Depends(get_db)
):
    try:
        return monthly_review.read(db, user.id, month)
    except ValueError as error:
        raise HTTPException(422, str(error)) from error
    except LookupError as error:
        raise HTTPException(404, str(error)) from error


@router.put("/{month}", response_model=MonthlyReviewOut)
def put_monthly_review(
    value: MonthlyReviewIn,
    month: str = Month,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    try:
        result = monthly_review.save(db, user.id, month, value.model_dump())
        db.commit()
        return result
    except (ValueError, IntegrityError) as error:
        db.rollback()
        raise HTTPException(409, "盘点或账本已更新，请重新读取并合并修改") from error
    except LookupError as error:
        db.rollback()
        raise HTTPException(404, str(error)) from error


@router.post("/{month}/clear", response_model=MonthlyReviewOut)
def clear_monthly_review(
    value: MonthlyReviewIn,
    month: str = Month,
    user: User = Depends(current_user),
    db: Session = Depends(get_db),
):
    try:
        result = monthly_review.save(db, user.id, month, value.model_dump(), clear=True)
        db.commit()
        return result
    except (ValueError, IntegrityError) as error:
        db.rollback()
        raise HTTPException(409, "盘点已更新，请重新读取") from error
    except LookupError as error:
        db.rollback()
        raise HTTPException(404, str(error)) from error
