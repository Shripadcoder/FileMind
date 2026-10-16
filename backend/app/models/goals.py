from datetime import date, datetime

from sqlalchemy import Date, DateTime, Float, ForeignKey, Index, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.time import utcnow
from app.db.base import Base

GOAL_TYPES = ("course", "assignment", "coding", "project", "reading", "custom")
GOAL_STATUSES = ("not_started", "in_progress", "completed", "on_hold")
GOAL_PRIORITIES = ("low", "medium", "high", "urgent")
PROGRESS_SOURCES = ("manual", "tasks", "milestones")

# Sensible derivation default per goal type. Users can override per goal.
DEFAULT_PROGRESS_SOURCE = {
    "course": "tasks",       # completed lectures / total lectures
    "assignment": "tasks",   # completed subtasks / total subtasks
    "coding": "manual",      # solved problems counted by the user
    "project": "milestones", # completed milestones / total milestones
    "reading": "manual",     # pages (or chapters) read
    "custom": "manual",
}

DEFAULT_UNITS = {
    "course": "lectures",
    "assignment": "tasks",
    "coding": "problems",
    "project": "milestones",
    "reading": "pages",
    "custom": "%",
}


class Goal(Base):
    __tablename__ = "goals"
    __table_args__ = (
        Index("ix_goals_owner_status", "owner_id", "status"),
        Index("ix_goals_owner_target", "owner_id", "target_date"),
        Index("ix_goals_owner_type", "owner_id", "goal_type"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    owner_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    goal_type: Mapped[str] = mapped_column(String(20), default="custom")
    title: Mapped[str] = mapped_column(String(255))
    description: Mapped[str] = mapped_column(Text, default="")
    category: Mapped[str] = mapped_column(String(120), default="")
    priority: Mapped[str] = mapped_column(String(10), default="medium")
    status: Mapped[str] = mapped_column(String(15), default="not_started")
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True, default=None)
    target_date: Mapped[date | None] = mapped_column(Date, nullable=True, default=None)
    # Manual measurable progress (used when progress_source == "manual", and as
    # fallback when a derived source has no items yet).
    target_value: Mapped[float] = mapped_column(Float, default=100.0)
    current_value: Mapped[float] = mapped_column(Float, default=0.0)
    unit: Mapped[str] = mapped_column(String(40), default="%")
    progress_source: Mapped[str] = mapped_column(String(15), default="manual")
    notes: Mapped[str] = mapped_column(Text, default="")
    external_links: Mapped[list] = mapped_column(JSON, default=list)
    reminder_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    owner: Mapped["User"] = relationship()
    tasks: Mapped[list["Task"]] = relationship(
        back_populates="goal", cascade="all, delete-orphan", order_by="Task.position"
    )
    milestones: Mapped[list["Milestone"]] = relationship(
        back_populates="goal", cascade="all, delete-orphan", order_by="Milestone.position"
    )


class Task(Base):
    __tablename__ = "tasks"
    __table_args__ = (Index("ix_tasks_goal_status", "goal_id", "status"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    goal_id: Mapped[int] = mapped_column(
        ForeignKey("goals.id", ondelete="CASCADE"), index=True
    )
    owner_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(String(255))
    description: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(15), default="todo")  # todo|in_progress|done
    priority: Mapped[str] = mapped_column(String(10), default="medium")
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True, default=None)
    position: Mapped[int] = mapped_column(default=0)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    goal: Mapped[Goal] = relationship(back_populates="tasks")


class Milestone(Base):
    __tablename__ = "milestones"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    goal_id: Mapped[int] = mapped_column(
        ForeignKey("goals.id", ondelete="CASCADE"), index=True
    )
    owner_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(String(255))
    description: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(15), default="not_started")
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True, default=None)
    position: Mapped[int] = mapped_column(default=0)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)

    goal: Mapped[Goal] = relationship(back_populates="milestones")
