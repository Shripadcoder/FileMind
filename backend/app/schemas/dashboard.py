from datetime import date, datetime

from pydantic import BaseModel

from app.schemas.activities import ActivityOut
from app.schemas.goals import ProgressOut
from app.schemas.library import FileOut


class BriefGoal(BaseModel):
    id: int
    title: str
    goal_type: str
    category: str
    status: str
    priority: str
    target_date: date | None
    progress: ProgressOut
    health: str


class BriefTask(BaseModel):
    id: int
    goal_id: int
    goal_title: str
    title: str
    status: str
    due_date: date | None


class CategoryProgress(BaseModel):
    category: str
    goals: int
    avg_progress: float


class TypeProgress(BaseModel):
    goal_type: str
    goals: int
    avg_progress: float


class DayCount(BaseModel):
    date: str
    count: int


class TypeCount(BaseModel):
    activity_type: str
    count: int
    total_value: float


class CodingStats(BaseModel):
    problems_solved_total: float
    problems_this_week: float
    active_goals: int


class ProjectInfo(BaseModel):
    id: int
    title: str
    milestones_done: int
    milestones_total: int
    progress: float
    target_date: date | None


class CourseInfo(BaseModel):
    id: int
    title: str
    progress: float
    tasks_done: int
    tasks_total: int
    target_date: date | None
    health: str


class ReminderInfo(BaseModel):
    goal_id: int
    goal_title: str
    reminder_at: datetime


class DashboardSummary(BaseModel):
    active_goals: int
    completed_goals: int
    on_hold_goals: int
    overdue_goals: list[BriefGoal]
    overdue_tasks: list[BriefTask]
    upcoming_tasks: list[BriefTask]
    upcoming_goals: list[BriefGoal]
    today_items: list[BriefTask]
    reminders: list[ReminderInfo]
    progress_by_category: list[CategoryProgress]
    progress_by_type: list[TypeProgress]
    weekly_activity: list[DayCount]
    activity_by_type: list[TypeCount]
    activity_calendar: list[DayCount]
    courses: list[CourseInfo]
    coding: CodingStats
    projects: list[ProjectInfo]
    recent_files: list[FileOut]
    recent_activities: list[ActivityOut]
