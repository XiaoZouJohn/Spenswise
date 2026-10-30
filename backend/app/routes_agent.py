from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .auth import current_user
from .db import get_db
from .models import User
from .schemas import AgentBrief, AgentPreferencesIn, AgentPreferencesOut
from .services import agent

router = APIRouter(prefix="/api/agent", tags=["agent"])


@router.get("/preferences", response_model=AgentPreferencesOut)
def agent_preferences(user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    return agent.preferences(db, user.id)


@router.put("/preferences", response_model=AgentPreferencesOut)
def update_agent_preferences(
    value: AgentPreferencesIn, user: User = Depends(current_user), db: Session = Depends(get_db)
) -> dict:
    return agent.save_preferences(
        db, user.id, value.model_dump(exclude_unset=True, exclude_none=True)
    )


@router.get("/status", response_model=AgentBrief)
def agent_status(user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    return agent.status(db, user.id)


@router.post("/brief", response_model=AgentBrief)
def agent_brief(user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict:
    return agent.briefing(db, user.id)
