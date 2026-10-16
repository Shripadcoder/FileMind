from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.api.activities import activity_to_out
from app.api.deps import get_current_user
from app.core.time import utcnow
from app.db.session import get_db
from app.models.activity import Activity
from app.models.goals import (
    DEFAULT_PROGRESS_SOURCE,
    DEFAULT_UNITS,
    Goal,
    Milestone,
    Task,
)
from app.models.user import User
from app.schemas.activities import ActivityOut
from app.schemas.goals import (
    GoalCreate,
    GoalDetail,
    GoalOut,
    GoalTypeInfo,
    GoalUpdate,
    MilestoneCreate,
    MilestoneOut,
    MilestoneUpdate,
    TaskCreate,
    TaskOut,
    TaskUpdate,
    goal_type_catalog,
    validate_goal_enums,
    validate_progress_source,
)
from app.services.activity_log import log_activity
from app.services.progress import compute_progress, goal_health

router = APIRouter(tags=["goals"])

TASK_STATUSES = ("todo", "in_progress", "done")
MILESTONE_STATUSES = ("not_started", "in_progress", "completed")


def _check(value: str | None, allowed: tuple[str, ...], kind: str) -> None:
    if value is not None and value not in allowed:
        raise HTTPException(status_code=422, detail=f"Unknown {kind}: {value}")


def get_owned_goal(db: Session, user: User, goal_id: int) -> Goal:
    goal = db.execute(
        select(Goal).where(Goal.id == goal_id, Goal.owner_id == user.id)
    ).scalar_one_or_none()
    if goal is None:
        raise HTTPException(status_code=404, detail="Goal not found")
    return goal


def get_owned_task(db: Session, user: User, task_id: int) -> Task:
    task = db.execute(
        select(Task).join(Goal, Task.goal_id == Goal.id).where(
            Task.id == task_id, Goal.owner_id == user.id
        )
    ).scalar_one_or_none()
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


def get_owned_milestone(db: Session, user: User, milestone_id: int) -> Milestone:
    milestone = db.execute(
        select(Milestone).join(Goal, Milestone.goal_id == Goal.id).where(
            Milestone.id == milestone_id, Goal.owner_id == user.id
        )
    ).scalar_one_or_none()
    if milestone is None:
        raise HTTPException(status_code=404, detail="Milestone not found")
    return milestone


def serialize_goal(goal: Goal, today: date, detail: bool = False) -> GoalOut | GoalDetail:
    progress = compute_progress(
        goal.goal_type, goal.progress_source, goal.current_value,
        goal.target_value, goal.unit, list(goal.tasks), list(goal.milestones),
    )
    health = goal_health(goal.status, progress.percent, goal.start_date, goal.target_date, today)
    tasks_done = sum(1 for t in goal.tasks if t.status == "done")
    milestones_done = sum(1 for m in goal.milestones if m.status == "completed")
    base = dict(
        id=goal.id, goal_type=goal.goal_type, title=goal.title,
        description=goal.description or "", category=goal.category or "",
        priority=goal.priority, status=goal.status,
        start_date=goal.start_date, target_date=goal.target_date,
        target_value=goal.target_value, current_value=goal.current_value,
        unit=goal.unit, progress_source=goal.progress_source,
        notes=goal.notes or "",
        external_links=goal.external_links or [],
        reminder_at=goal.reminder_at, completed_at=goal.completed_at,
        created_at=goal.created_at, updated_at=goal.updated_at,
        progress=progress, health=health,
        task_count=len(goal.tasks), tasks_done=tasks_done,
        milestone_count=len(goal.milestones), milestones_done=milestones_done,
    )
    if detail:
        return GoalDetail(
            **base,
            tasks=[serialize_task(t) for t in goal.tasks],
            milestones=[serialize_milestone(m) for m in goal.milestones],
        )
    return GoalOut(**base)


def serialize_task(task: Task) -> TaskOut:
    return TaskOut(
        id=task.id, goal_id=task.goal_id, title=task.title,
        description=task.description or "", status=task.status,
        priority=task.priority, due_date=task.due_date, position=task.position,
        completed_at=task.completed_at, created_at=task.created_at,
        updated_at=task.updated_at,
    )


def serialize_milestone(milestone: Milestone) -> MilestoneOut:
    return MilestoneOut(
        id=milestone.id, goal_id=milestone.goal_id, title=milestone.title,
        description=milestone.description or "", status=milestone.status,
        due_date=milestone.due_date, position=milestone.position,
        completed_at=milestone.completed_at, created_at=milestone.created_at,
        updated_at=milestone.updated_at,
    )


@router.get("/goal-types", response_model=list[GoalTypeInfo])
def list_goal_types(current: User = Depends(get_current_user)):
    return goal_type_catalog()


@router.post("/goals", response_model=GoalDetail, status_code=status.HTTP_201_CREATED)
def create_goal(
    body: GoalCreate,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    validate_goal_enums(body.goal_type, body.status, body.priority)
    validate_progress_source(body.progress_source)
    goal = Goal(
        owner_id=current.id,
        goal_type=body.goal_type,
        title=body.title.strip(),
        description=body.description.strip(),
        category=body.category.strip(),
        priority=body.priority,
        status=body.status,
        start_date=body.start_date,
        target_date=body.target_date,
        target_value=body.target_value,
        current_value=body.current_value,
        unit=(body.unit or DEFAULT_UNITS[body.goal_type])[:40],
        progress_source=body.progress_source or DEFAULT_PROGRESS_SOURCE[body.goal_type],
        notes=body.notes.strip(),
        external_links=[link.model_dump() for link in body.external_links],
        reminder_at=body.reminder_at.replace(tzinfo=None) if body.reminder_at and body.reminder_at.tzinfo else body.reminder_at,
    )
    if goal.status == "completed":
        goal.completed_at = utcnow()
    db.add(goal)
    db.flush()
    log_activity(
        db, owner_id=current.id, activity_type="goal_created",
        title=f"Started goal: {goal.title}", goal_id=goal.id,
        details={"goal_type": goal.goal_type},
    )
    db.commit()
    db.refresh(goal)
    result = serialize_goal(goal, date.today(), detail=True)
    assert isinstance(result, GoalDetail)
    return result


@router.get("/goals", response_model=list[GoalOut])
def list_goals(
    status: str | None = Query(default=None),
    goal_type: str | None = Query(default=None),
    category: str | None = Query(default=None),
    priority: str | None = Query(default=None),
    overdue: bool | None = Query(default=None),
    q: str | None = Query(default=None),
    sort: str = Query(default="target_date"),
    order: str = Query(default="asc"),
    limit: int = Query(default=100, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    validate_goal_enums(goal_type, status, priority)
    query = select(Goal).where(Goal.owner_id == current.id)
    if status:
        query = query.where(Goal.status == status)
    if goal_type:
        query = query.where(Goal.goal_type == goal_type)
    if category:
        query = query.where(Goal.category == category.strip())
    if priority:
        query = query.where(Goal.priority == priority)
    if q:
        like = f"%{q.strip()}%"
        query = query.where(or_(Goal.title.ilike(like), Goal.description.ilike(like)))
    today = date.today()
    if overdue is True:
        query = query.where(Goal.target_date < today, Goal.status != "completed")
    elif overdue is False:
        query = query.where(or_(Goal.target_date.is_(None), Goal.target_date >= today))
    sort_col = {
        "target_date": Goal.target_date, "created_at": Goal.created_at, "title": Goal.title,
    }.get(sort, Goal.target_date)
    query = query.order_by(sort_col.asc() if order == "asc" else sort_col.desc())
    goals = db.execute(query.limit(limit).offset(offset)).scalars().all()
    out = [serialize_goal(g, today) for g in goals]
    if sort == "progress":
        out.sort(key=lambda g: g.progress.percent, reverse=(order != "asc"))
    return out


@router.get("/goals/{goal_id}", response_model=GoalDetail)
def get_goal(
    goal_id: int,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    goal = get_owned_goal(db, current, goal_id)
    result = serialize_goal(goal, date.today(), detail=True)
    assert isinstance(result, GoalDetail)
    return result


@router.patch("/goals/{goal_id}", response_model=GoalDetail)
def update_goal(
    goal_id: int,
    patch: GoalUpdate,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    goal = get_owned_goal(db, current, goal_id)
    validate_goal_enums(None, patch.status, patch.priority)
    validate_progress_source(patch.progress_source)

    old_status, old_value = goal.status, goal.current_value
    provided = patch.model_fields_set
    for field in ("title", "description", "category", "notes"):
        value = getattr(patch, field)
        if value is not None:
            setattr(goal, field, value.strip())
    for field in ("priority", "status", "target_value", "current_value", "unit",
                  "progress_source"):
        value = getattr(patch, field)
        if value is not None:
            setattr(goal, field, value[:40] if field == "unit" else value)
    # Nullable dates: an explicit null clears the date.
    for field in ("start_date", "target_date", "reminder_at"):
        if field in provided:
            value = getattr(patch, field)
            if value is not None and hasattr(value, "tzinfo") and value.tzinfo is not None:
                value = value.replace(tzinfo=None)
            setattr(goal, field, value)
    if patch.external_links is not None:
        goal.external_links = [link.model_dump() for link in patch.external_links]

    if patch.status is not None and patch.status != old_status:
        if patch.status == "completed":
            goal.completed_at = utcnow()
            log_activity(db, owner_id=current.id, activity_type="goal_completed",
                         title=f"Completed goal: {goal.title}", goal_id=goal.id)
        else:
            goal.completed_at = None
            log_activity(db, owner_id=current.id, activity_type="goal_updated",
                         title=f"Reopened goal: {goal.title}", goal_id=goal.id,
                         details={"old_status": old_status, "new_status": patch.status})
    if patch.current_value is not None and patch.current_value != old_value:
        log_activity(db, owner_id=current.id, activity_type="progress_updated",
                     title=f"Progress on {goal.title}: {patch.current_value:g} {goal.unit}",
                     goal_id=goal.id,
                     value=patch.current_value - old_value,
                     details={"old_value": old_value, "new_value": patch.current_value})
    db.commit()
    db.refresh(goal)
    result = serialize_goal(goal, date.today(), detail=True)
    assert isinstance(result, GoalDetail)
    return result


@router.delete("/goals/{goal_id}")
def delete_goal(
    goal_id: int,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    goal = get_owned_goal(db, current, goal_id)
    # Preserve history explicitly: activities keep their rows with goal_id nulled
    # (the FK also declares SET NULL, but explicit beats backend-specific DDL).
    db.query(Activity).filter(Activity.goal_id == goal.id).update(
        {Activity.goal_id: None}, synchronize_session=False
    )
    db.delete(goal)  # tasks/milestones cascade; activities survive via the update above
    db.commit()
    return {"id": goal_id, "deleted": True}


# ---------- tasks ----------


@router.post("/goals/{goal_id}/tasks", response_model=TaskOut, status_code=status.HTTP_201_CREATED)
def create_task(
    goal_id: int,
    body: TaskCreate,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    goal = get_owned_goal(db, current, goal_id)
    _check(body.status, TASK_STATUSES, "task status")
    _check(body.priority, ("low", "medium", "high", "urgent"), "priority")
    position = max([t.position for t in goal.tasks], default=-1) + 1
    task = Task(
        goal_id=goal.id, owner_id=current.id, title=body.title.strip(),
        description=body.description.strip(), status=body.status,
        priority=body.priority, due_date=body.due_date, position=position,
    )
    if task.status == "done":
        task.completed_at = utcnow()
    db.add(task)
    db.commit()
    db.refresh(task)
    return serialize_task(task)


@router.patch("/tasks/{task_id}", response_model=TaskOut)
def update_task(
    task_id: int,
    body: TaskUpdate,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    task = get_owned_task(db, current, task_id)
    _check(body.status, TASK_STATUSES, "task status")
    _check(body.priority, ("low", "medium", "high", "urgent"), "priority")
    if body.title is not None:
        task.title = body.title.strip()
    if body.description is not None:
        task.description = body.description.strip()
    if body.priority is not None:
        task.priority = body.priority
    if "due_date" in body.model_fields_set:
        task.due_date = body.due_date
    if body.position is not None:
        task.position = body.position
    if body.status is not None and body.status != task.status:
        task.status = body.status
        if body.status == "done":
            task.completed_at = utcnow()
            log_activity(db, owner_id=current.id, activity_type="task_completed",
                         title=f"Completed task: {task.title}", goal_id=task.goal_id,
                         value=1, details={"task_id": task.id})
        else:
            task.completed_at = None
    db.commit()
    db.refresh(task)
    return serialize_task(task)


@router.delete("/tasks/{task_id}")
def delete_task(
    task_id: int,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    task = get_owned_task(db, current, task_id)
    db.delete(task)
    db.commit()
    return {"id": task_id, "deleted": True}


# ---------- milestones ----------


@router.post("/goals/{goal_id}/milestones", response_model=MilestoneOut,
             status_code=status.HTTP_201_CREATED)
def create_milestone(
    goal_id: int,
    body: MilestoneCreate,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    goal = get_owned_goal(db, current, goal_id)
    _check(body.status, MILESTONE_STATUSES, "milestone status")
    position = max([m.position for m in goal.milestones], default=-1) + 1
    milestone = Milestone(
        goal_id=goal.id, owner_id=current.id, title=body.title.strip(),
        description=body.description.strip(), status=body.status,
        due_date=body.due_date, position=position,
    )
    if milestone.status == "completed":
        milestone.completed_at = utcnow()
    db.add(milestone)
    db.commit()
    db.refresh(milestone)
    return serialize_milestone(milestone)


@router.patch("/milestones/{milestone_id}", response_model=MilestoneOut)
def update_milestone(
    milestone_id: int,
    body: MilestoneUpdate,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    milestone = get_owned_milestone(db, current, milestone_id)
    _check(body.status, MILESTONE_STATUSES, "milestone status")
    if body.title is not None:
        milestone.title = body.title.strip()
    if body.description is not None:
        milestone.description = body.description.strip()
    if "due_date" in body.model_fields_set:
        milestone.due_date = body.due_date
    if body.position is not None:
        milestone.position = body.position
    if body.status is not None and body.status != milestone.status:
        milestone.status = body.status
        if body.status == "completed":
            milestone.completed_at = utcnow()
            log_activity(db, owner_id=current.id, activity_type="milestone_completed",
                         title=f"Completed milestone: {milestone.title}",
                         goal_id=milestone.goal_id, value=1,
                         details={"milestone_id": milestone.id})
        else:
            milestone.completed_at = None
    db.commit()
    db.refresh(milestone)
    return serialize_milestone(milestone)


@router.delete("/milestones/{milestone_id}")
def delete_milestone(
    milestone_id: int,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    milestone = get_owned_milestone(db, current, milestone_id)
    db.delete(milestone)
    db.commit()
    return {"id": milestone_id, "deleted": True}


@router.get("/goals/{goal_id}/activities", response_model=list[ActivityOut])
def goal_activities(
    goal_id: int,
    limit: int = Query(default=20, le=100),
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    goal = get_owned_goal(db, current, goal_id)
    rows = db.execute(
        select(Activity)
        .where(Activity.owner_id == current.id, Activity.goal_id == goal.id)
        .order_by(Activity.occurred_at.desc())
        .limit(limit)
    ).scalars()
    return [activity_to_out(a, goal_title=goal.title) for a in rows]


@router.get("/tasks/overdue", response_model=list[TaskOut])
def overdue_tasks(
    db: Session = Depends(get_db), current: User = Depends(get_current_user)
):
    today = date.today()
    rows = db.execute(
        select(Task).join(Goal, Task.goal_id == Goal.id).where(
            Goal.owner_id == current.id,
            Task.status != "done",
            Task.due_date < today,
        ).order_by(Task.due_date)
    ).scalars()
    return [serialize_task(t) for t in rows]


@router.get("/tasks/upcoming", response_model=list[TaskOut])
def upcoming_tasks(
    days: int = Query(default=7, ge=1, le=60),
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    from datetime import timedelta

    today = date.today()
    rows = db.execute(
        select(Task).join(Goal, Task.goal_id == Goal.id).where(
            Goal.owner_id == current.id,
            Task.status != "done",
            Task.due_date >= today,
            Task.due_date <= today + timedelta(days=days),
        ).order_by(Task.due_date)
    ).scalars()
    return [serialize_task(t) for t in rows]
