"""Productivity dashboard. Every number is aggregated from the user's own
rows at request time — there are no demo values anywhere in this module."""

from collections import defaultdict
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.activities import activity_to_out
from app.api.deps import get_current_user
from app.api.goals import serialize_goal
from app.api.helpers import file_to_out
from app.core.time import utcnow
from app.db.session import get_db
from app.models.activity import Activity
from app.models.file import File
from app.models.goals import Goal, Task
from app.models.user import User
from app.schemas.dashboard import (
    BriefGoal,
    BriefTask,
    CategoryProgress,
    CodingStats,
    CourseInfo,
    DashboardSummary,
    DayCount,
    ProjectInfo,
    ReminderInfo,
    TypeCount,
    TypeProgress,
)
from app.schemas.goals import GoalOut

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("/summary", response_model=DashboardSummary)
def dashboard_summary(
    category: str | None = Query(default=None),
    activity_from: date | None = Query(default=None),
    activity_to: date | None = Query(default=None),
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    today = date.today()
    now = utcnow()

    goal_query = select(Goal).where(Goal.owner_id == current.id)
    if category:
        goal_query = goal_query.where(Goal.category == category.strip())
    goals = list(db.execute(goal_query.order_by(Goal.target_date)).scalars().all())
    serialized: list[GoalOut] = [serialize_goal(g, today) for g in goals]  # type: ignore[misc]

    goal_by_id = {g.id: (g, s) for g, s in zip(goals, serialized)}

    def brief_goal(g: Goal, s: GoalOut) -> BriefGoal:
        return BriefGoal(
            id=g.id, title=g.title, goal_type=g.goal_type, category=g.category or "",
            status=g.status, priority=g.priority, target_date=g.target_date,
            progress=s.progress, health=s.health,
        )

    active = [s for s in serialized if s.status in ("not_started", "in_progress")]
    completed = [s for s in serialized if s.status == "completed"]
    on_hold = [s for s in serialized if s.status == "on_hold"]

    overdue_goals = [brief_goal(g, s) for g, s in zip(goals, serialized) if s.health == "overdue"]
    upcoming_goals = [
        brief_goal(g, s) for g, s in zip(goals, serialized)
        if g.target_date is not None and g.status != "completed"
        and 0 <= (g.target_date - today).days <= 7
    ]

    # Tasks across the user's goals.
    task_query = (
        select(Task, Goal.title).join(Goal, Task.goal_id == Goal.id)
        .where(Goal.owner_id == current.id)
    )
    if category:
        task_query = task_query.where(Goal.category == category.strip())
    task_rows = db.execute(task_query.order_by(Task.due_date)).all()

    def brief_task(t: Task, goal_title: str) -> BriefTask:
        return BriefTask(
            id=t.id, goal_id=t.goal_id, goal_title=goal_title, title=t.title,
            status=t.status, due_date=t.due_date,
        )

    overdue_tasks, upcoming_tasks, today_items = [], [], []
    for task, goal_title in task_rows:
        if task.status == "done":
            continue
        item = brief_task(task, goal_title)
        if task.due_date is not None and task.due_date < today:
            overdue_tasks.append(item)
            today_items.append(item)  # overdue work is due today too
        elif task.due_date is not None and task.due_date == today:
            today_items.append(item)
        elif task.due_date is not None and 0 < (task.due_date - today).days <= 7:
            upcoming_tasks.append(item)
    # Goals due today join the "today" list as work items is misleading (they
    # are not tasks), so they stay in upcoming_goals; tasks carry the day view.

    reminders = [
        ReminderInfo(goal_id=g.id, goal_title=g.title, reminder_at=g.reminder_at)
        for g in goals
        if g.reminder_at is not None and g.status != "completed"
        and g.reminder_at <= now + timedelta(days=7)
    ]
    reminders.sort(key=lambda r: r.reminder_at)

    # Progress breakdowns.
    by_cat: dict[str, list[float]] = defaultdict(list)
    by_type: dict[str, list[float]] = defaultdict(list)
    for g, s in zip(goals, serialized):
        if g.status == "completed":
            continue
        by_cat[g.category or "Uncategorized"].append(s.progress.percent)
        by_type[g.goal_type].append(s.progress.percent)
    progress_by_category = [
        CategoryProgress(category=name, goals=len(v), avg_progress=round(sum(v) / len(v), 1))
        for name, v in sorted(by_cat.items())
    ]
    progress_by_type = [
        TypeProgress(goal_type=name, goals=len(v), avg_progress=round(sum(v) / len(v), 1))
        for name, v in sorted(by_type.items())
    ]

    # Activities: weekly series, range aggregation, 90-day calendar.
    week_start = today - timedelta(days=6)
    range_from = activity_from or (today - timedelta(days=30))
    range_to = activity_to or today

    def day_series(start: date, end: date, counts: dict[date, int]) -> list[DayCount]:
        series, day = [], start
        while day <= end:
            series.append(DayCount(date=day.isoformat(), count=counts.get(day, 0)))
            day += timedelta(days=1)
        return series

    weekly_rows = db.execute(
        select(func.date(Activity.occurred_at), func.count(Activity.id))
        .where(Activity.owner_id == current.id,
               Activity.occurred_at >= datetime(week_start.year, week_start.month, week_start.day))
        .group_by(func.date(Activity.occurred_at))
    ).all()
    weekly_counts = {date.fromisoformat(str(d)): c for d, c in weekly_rows}
    weekly_activity = day_series(week_start, today, weekly_counts)

    cal_start = today - timedelta(days=89)
    cal_rows = db.execute(
        select(func.date(Activity.occurred_at), func.count(Activity.id))
        .where(Activity.owner_id == current.id,
               Activity.occurred_at >= datetime(cal_start.year, cal_start.month, cal_start.day))
        .group_by(func.date(Activity.occurred_at))
    ).all()
    cal_counts = {date.fromisoformat(str(d)): c for d, c in cal_rows}
    activity_calendar = day_series(cal_start, today, cal_counts)

    type_rows = db.execute(
        select(Activity.activity_type, func.count(Activity.id), func.sum(Activity.value))
        .where(
            Activity.owner_id == current.id,
            Activity.occurred_at >= datetime(range_from.year, range_from.month, range_from.day),
            Activity.occurred_at <= datetime(range_to.year, range_to.month, range_to.day, 23, 59, 59),
        )
        .group_by(Activity.activity_type)
    ).all()
    activity_by_type = [
        TypeCount(activity_type=t, count=c, total_value=float(v or 0.0)) for t, c, v in type_rows
    ]

    # Goal-type spotlights.
    courses = [
        CourseInfo(id=g.id, title=g.title, progress=s.progress.percent,
                   tasks_done=s.tasks_done, tasks_total=s.task_count,
                   target_date=g.target_date, health=s.health)
        for g, s in zip(goals, serialized) if g.goal_type == "course"
    ]
    projects = [
        ProjectInfo(id=g.id, title=g.title, milestones_done=s.milestones_done,
                    milestones_total=s.milestone_count, progress=s.progress.percent,
                    target_date=g.target_date)
        for g, s in zip(goals, serialized) if g.goal_type == "project"
    ]
    coding_total = db.execute(
        select(func.sum(Activity.value)).where(
            Activity.owner_id == current.id, Activity.activity_type == "problem_solved")
    ).scalar() or 0.0
    coding_week = db.execute(
        select(func.sum(Activity.value)).where(
            Activity.owner_id == current.id, Activity.activity_type == "problem_solved",
            Activity.occurred_at >= datetime(week_start.year, week_start.month, week_start.day))
    ).scalar() or 0.0
    coding = CodingStats(
        problems_solved_total=float(coding_total),
        problems_this_week=float(coding_week),
        active_goals=sum(1 for g in goals if g.goal_type == "coding" and g.status != "completed"),
    )

    recent_files = db.execute(
        select(File).where(File.owner_id == current.id, File.trashed_at.is_(None))
        .order_by(File.created_at.desc()).limit(5)
    ).scalars()
    recent_acts = db.execute(
        select(Activity).where(Activity.owner_id == current.id)
        .order_by(Activity.occurred_at.desc()).limit(10)
    ).scalars()

    return DashboardSummary(
        active_goals=len(active), completed_goals=len(completed), on_hold_goals=len(on_hold),
        overdue_goals=overdue_goals, overdue_tasks=overdue_tasks,
        upcoming_tasks=upcoming_tasks, upcoming_goals=upcoming_goals,
        today_items=today_items, reminders=reminders,
        progress_by_category=progress_by_category, progress_by_type=progress_by_type,
        weekly_activity=weekly_activity, activity_by_type=activity_by_type,
        activity_calendar=activity_calendar, courses=courses, coding=coding,
        projects=projects,
        recent_files=[file_to_out(f) for f in recent_files],
        recent_activities=[activity_to_out(a) for a in recent_acts],
    )
