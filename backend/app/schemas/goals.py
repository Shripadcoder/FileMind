from datetime import date, datetime

from pydantic import BaseModel, Field

from app.models.goals import (
    DEFAULT_PROGRESS_SOURCE,
    DEFAULT_UNITS,
    GOAL_PRIORITIES,
    GOAL_STATUSES,
    GOAL_TYPES,
    PROGRESS_SOURCES,
)
from app.schemas.library import FileOut


class ExternalLink(BaseModel):
    label: str = Field(min_length=1, max_length=120)
    url: str = Field(min_length=1, max_length=2000)


class GoalCreate(BaseModel):
    goal_type: str = "custom"
    title: str = Field(min_length=1, max_length=255)
    description: str = Field(default="", max_length=5000)
    category: str = Field(default="", max_length=120)
    priority: str = "medium"
    status: str = "not_started"
    start_date: date | None = None
    target_date: date | None = None
    target_value: float = Field(default=100.0, gt=0)
    current_value: float = Field(default=0.0, ge=0)
    unit: str | None = Field(default=None, max_length=40)
    progress_source: str | None = None
    notes: str = Field(default="", max_length=5000)
    external_links: list[ExternalLink] = Field(default_factory=list)
    reminder_at: datetime | None = None


class GoalUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=5000)
    category: str | None = Field(default=None, max_length=120)
    priority: str | None = None
    status: str | None = None
    start_date: date | None = None
    target_date: date | None = None
    target_value: float | None = Field(default=None, gt=0)
    current_value: float | None = Field(default=None, ge=0)
    unit: str | None = Field(default=None, max_length=40)
    progress_source: str | None = None
    notes: str | None = Field(default=None, max_length=5000)
    external_links: list[ExternalLink] | None = None
    reminder_at: datetime | None = None


class ProgressOut(BaseModel):
    percent: float
    source_used: str
    current: float
    target: float
    unit: str
    detail: str


class TaskOut(BaseModel):
    id: int
    goal_id: int
    title: str
    description: str
    status: str
    priority: str
    due_date: date | None
    position: int
    completed_at: datetime | None
    created_at: datetime
    updated_at: datetime


class TaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    description: str = Field(default="", max_length=2000)
    status: str = "todo"
    priority: str = "medium"
    due_date: date | None = None


class TaskUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=2000)
    status: str | None = None
    priority: str | None = None
    due_date: date | None = None
    position: int | None = None


class MilestoneOut(BaseModel):
    id: int
    goal_id: int
    title: str
    description: str
    status: str
    due_date: date | None
    position: int
    completed_at: datetime | None
    created_at: datetime
    updated_at: datetime


class MilestoneCreate(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    description: str = Field(default="", max_length=2000)
    status: str = "not_started"
    due_date: date | None = None


class MilestoneUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=2000)
    status: str | None = None
    due_date: date | None = None
    position: int | None = None


class GoalOut(BaseModel):
    id: int
    goal_type: str
    title: str
    description: str
    category: str
    priority: str
    status: str
    start_date: date | None
    target_date: date | None
    target_value: float
    current_value: float
    unit: str
    progress_source: str
    notes: str
    external_links: list[ExternalLink]
    reminder_at: datetime | None
    completed_at: datetime | None
    created_at: datetime
    updated_at: datetime
    progress: ProgressOut
    health: str
    task_count: int = 0
    tasks_done: int = 0
    milestone_count: int = 0
    milestones_done: int = 0
    file_count: int = 0


class GoalDetail(GoalOut):
    tasks: list[TaskOut] = Field(default_factory=list)
    milestones: list[MilestoneOut] = Field(default_factory=list)
    linked_files: list["LinkedFileOut"] = Field(default_factory=list)
    suggested_files: list[FileOut] = Field(default_factory=list)


class GoalFileLinkCreate(BaseModel):
    file_id: int
    task_id: int | None = None
    note: str = Field(default="", max_length=500)


class LinkedFileOut(BaseModel):
    """A file attached to a goal, with the optional task it supports."""

    file: FileOut
    task_id: int | None
    task_title: str | None
    note: str
    created_at: datetime


class GoalLinkOut(BaseModel):
    """File-side view: which goals (and tasks) reference this file."""

    goal_id: int
    goal_title: str
    goal_type: str
    goal_status: str
    task_id: int | None
    task_title: str | None
    note: str
    created_at: datetime


class GoalTypeInfo(BaseModel):
    type: str
    label: str
    default_unit: str
    default_progress_source: str


def goal_type_catalog() -> list[GoalTypeInfo]:
    labels = {
        "course": "Online course",
        "assignment": "Assignment",
        "coding": "Coding practice",
        "project": "Software project",
        "reading": "Reading & learning",
        "custom": "Custom goal",
    }
    return [
        GoalTypeInfo(
            type=t,
            label=labels[t],
            default_unit=DEFAULT_UNITS[t],
            default_progress_source=DEFAULT_PROGRESS_SOURCE[t],
        )
        for t in GOAL_TYPES
    ]


def validate_goal_enums(goal_type: str | None, status: str | None, priority: str | None) -> None:
    from fastapi import HTTPException

    if goal_type is not None and goal_type not in GOAL_TYPES:
        raise HTTPException(status_code=422, detail=f"Unknown goal type: {goal_type}")
    if status is not None and status not in GOAL_STATUSES:
        raise HTTPException(status_code=422, detail=f"Unknown status: {status}")
    if priority is not None and priority not in GOAL_PRIORITIES:
        raise HTTPException(status_code=422, detail=f"Unknown priority: {priority}")


def validate_progress_source(value: str | None) -> None:
    from fastapi import HTTPException

    if value is not None and value not in PROGRESS_SOURCES:
        raise HTTPException(status_code=422, detail=f"Unknown progress source: {value}")
