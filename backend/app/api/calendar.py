"""Calendar events + reminders, computed from live rows.

Events unify the date-bearing records: task/milestone due dates, goal target
dates, goal reminders, and past activity occurrences. Delivery (email/push)
is out of scope — reminders are stored, surfaced here and on the dashboard,
and editable in the goal UI."""

from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.core.time import utcnow
from app.db.session import get_db
from app.models.activity import Activity
from app.models.goals import Goal, Milestone, Task
from app.models.user import User
from app.schemas.advanced import CalendarEvent, ReminderOut

router = APIRouter(tags=["advanced"])


@router.get("/calendar", response_model=list[CalendarEvent])
def calendar_events(
    start: date | None = Query(default=None),
    end: date | None = Query(default=None),
    kinds: str | None = Query(default=None, description="Comma-separated event kinds"),
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    today = date.today()
    start = start or today.replace(day=1)
    end = end or (today.replace(day=1) + timedelta(days=62)).replace(day=1) - timedelta(days=1)
    if end < start:
        end = start
    wanted = {k.strip() for k in kinds.split(",")} if kinds else None
    if wanted:
        unknown = wanted - {"task", "goal", "milestone", "reminder", "activity"}
        from fastapi import HTTPException

        if unknown:
            raise HTTPException(status_code=422, detail=f"Unknown kinds: {sorted(unknown)}")

    def want(kind: str) -> bool:
        return wanted is None or kind in wanted

    events: list[CalendarEvent] = []
    goals = list(db.execute(select(Goal).where(Goal.owner_id == current.id)).scalars())
    for goal in goals:
        if want("goal") and goal.target_date and start <= goal.target_date <= end:
            events.append(CalendarEvent(
                id=f"goal-{goal.id}", kind="goal", title=f"Due: {goal.title}",
                date=goal.target_date.isoformat(), goal_id=goal.id,
                goal_title=goal.title, ref_id=goal.id))
        if want("reminder") and goal.reminder_at and goal.status != "completed":
            day = goal.reminder_at.date()
            if start <= day <= end:
                events.append(CalendarEvent(
                    id=f"reminder-{goal.id}", kind="reminder",
                    title=f"Reminder: {goal.title}", date=day.isoformat(),
                    datetime=goal.reminder_at.isoformat(), goal_id=goal.id,
                    goal_title=goal.title, ref_id=goal.id))

    if want("task") or want("milestone"):
        tasks = db.execute(
            select(Task, Goal.title).join(Goal, Task.goal_id == Goal.id)
            .where(Goal.owner_id == current.id, Task.status != "done",
                   Task.due_date >= start, Task.due_date <= end)).all()
        if want("task"):
            for task, goal_title in tasks:
                events.append(CalendarEvent(
                    id=f"task-{task.id}", kind="task", title=task.title,
                    date=task.due_date.isoformat() if task.due_date else start.isoformat(),
                    goal_id=task.goal_id, goal_title=goal_title, ref_id=task.id))
        if want("milestone"):
            milestones = db.execute(
                select(Milestone, Goal.title).join(Goal, Milestone.goal_id == Goal.id)
                .where(Goal.owner_id == current.id, Milestone.status != "completed",
                       Milestone.due_date >= start, Milestone.due_date <= end)).all()
            for milestone, goal_title in milestones:
                events.append(CalendarEvent(
                    id=f"milestone-{milestone.id}", kind="milestone",
                    title=milestone.title,
                    date=milestone.due_date.isoformat() if milestone.due_date else start.isoformat(),
                    goal_id=milestone.goal_id, goal_title=goal_title,
                    ref_id=milestone.id))

    if want("activity"):
        acts = db.execute(
            select(Activity).where(
                Activity.owner_id == current.id,
                Activity.occurred_at >= datetime(start.year, start.month, start.day),
                Activity.occurred_at <= datetime(end.year, end.month, end.day, 23, 59, 59))
            .order_by(Activity.occurred_at)).scalars()
        for act in acts:
            events.append(CalendarEvent(
                id=f"activity-{act.id}", kind="activity", title=act.title,
                date=act.occurred_at.date().isoformat(),
                datetime=act.occurred_at.isoformat(), goal_id=act.goal_id,
                ref_id=act.id))

    events.sort(key=lambda e: (e.date, e.datetime or "", e.kind))
    return events


@router.get("/reminders", response_model=list[ReminderOut])
def upcoming_reminders(
    days: int = Query(default=7, ge=1, le=90),
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    horizon = utcnow() + timedelta(days=days)
    goals = db.execute(
        select(Goal).where(
            Goal.owner_id == current.id, Goal.status != "completed",
            Goal.reminder_at.is_not(None), Goal.reminder_at <= horizon)
        .order_by(Goal.reminder_at)).scalars()
    return [ReminderOut(goal_id=g.id, goal_title=g.title,
                         reminder_at=g.reminder_at, target_date=g.target_date)
            for g in goals if g.reminder_at is not None]
