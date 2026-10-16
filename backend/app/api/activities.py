from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.activity import Activity
from app.models.goals import Goal
from app.models.user import User
from app.schemas.activities import ActivityCreate, ActivityOut, validate_activity_type
from app.services.activity_log import log_activity

router = APIRouter(prefix="/activities", tags=["activities"])


def activity_to_out(activity: Activity, goal_title: str | None = None) -> ActivityOut:
    return ActivityOut(
        id=activity.id,
        goal_id=activity.goal_id,
        goal_title=goal_title or (activity.goal.title if activity.goal is not None else None),
        activity_type=activity.activity_type,
        title=activity.title,
        description=activity.description or "",
        value=activity.value,
        details=activity.details or {},
        source=activity.source,
        occurred_at=activity.occurred_at,
        created_at=activity.created_at,
    )


@router.get("", response_model=list[ActivityOut])
def list_activities(
    activity_type: str | None = Query(default=None),
    goal_id: int | None = Query(default=None),
    occurred_from: datetime | None = Query(default=None),
    occurred_to: datetime | None = Query(default=None),
    limit: int = Query(default=50, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    query = select(Activity).where(Activity.owner_id == current.id)
    if activity_type:
        validate_activity_type(activity_type)
        query = query.where(Activity.activity_type == activity_type)
    if goal_id is not None:
        query = query.where(Activity.goal_id == goal_id)
    if occurred_from is not None:
        naive = occurred_from.replace(tzinfo=None) if occurred_from.tzinfo else occurred_from
        query = query.where(Activity.occurred_at >= naive)
    if occurred_to is not None:
        naive = occurred_to.replace(tzinfo=None) if occurred_to.tzinfo else occurred_to
        query = query.where(Activity.occurred_at <= naive)
    rows = db.execute(
        query.order_by(Activity.occurred_at.desc()).limit(limit).offset(offset)
    ).scalars()
    return [activity_to_out(a) for a in rows]


@router.post("", response_model=ActivityOut, status_code=status.HTTP_201_CREATED)
def create_activity(
    body: ActivityCreate,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    validate_activity_type(body.activity_type)
    if body.goal_id is not None:
        goal = db.execute(
            select(Goal).where(Goal.id == body.goal_id, Goal.owner_id == current.id)
        ).scalar_one_or_none()
        if goal is None:
            raise HTTPException(status_code=404, detail="Goal not found")
    activity = log_activity(
        db,
        owner_id=current.id,
        activity_type=body.activity_type,
        title=body.title.strip(),
        description=body.description.strip(),
        goal_id=body.goal_id,
        value=body.value,
        details=body.details,
        source="manual",
        occurred_at=body.occurred_at,
    )
    db.commit()
    db.refresh(activity)
    return activity_to_out(activity)


@router.delete("/{activity_id}")
def delete_activity(
    activity_id: int,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    activity = db.execute(
        select(Activity).where(Activity.id == activity_id, Activity.owner_id == current.id)
    ).scalar_one_or_none()
    if activity is None:
        raise HTTPException(status_code=404, detail="Activity not found")
    db.delete(activity)
    db.commit()
    return {"id": activity_id, "deleted": True}
