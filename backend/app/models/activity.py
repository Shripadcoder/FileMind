from datetime import datetime

from sqlalchemy import DateTime, Float, ForeignKey, Index, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.time import utcnow
from app.db.base import Base

# Fixed vocabulary so dashboard aggregations stay meaningful. Free-form notes
# go in title/description; the type field stays enumerable.
ACTIVITY_TYPES = (
    "lecture_completed",
    "problem_solved",
    "assignment_submitted",
    "milestone_completed",
    "task_completed",
    "goal_created",
    "goal_updated",
    "goal_completed",
    "progress_updated",
    "file_uploaded",
    "document_reviewed",
    "reading_session",
    "note",
)


class Activity(Base):
    """One meaningful event. Rows are facts (never fabricated): manual entries
    come from the user, auto entries are written alongside the mutation that
    caused them (task done, goal completed, file uploaded)."""

    __tablename__ = "activities"
    __table_args__ = (
        Index("ix_activities_owner_occurred", "owner_id", "occurred_at"),
        Index("ix_activities_owner_type", "owner_id", "activity_type"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    owner_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    goal_id: Mapped[int | None] = mapped_column(
        ForeignKey("goals.id", ondelete="SET NULL"), nullable=True, default=None, index=True
    )
    activity_type: Mapped[str] = mapped_column(String(30), index=True)
    title: Mapped[str] = mapped_column(String(255))
    description: Mapped[str] = mapped_column(Text, default="")
    # Measurable amount, e.g. problems solved or pages read in this session.
    value: Mapped[float] = mapped_column(Float, default=0.0)
    # Machine-readable context, e.g. {"file_id": 3, "task_id": 9}. Never secrets.
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    source: Mapped[str] = mapped_column(String(10), default="manual")  # manual|auto
    occurred_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    goal: Mapped["Goal | None"] = relationship()
