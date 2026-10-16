from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.time import utcnow
from app.db.base import Base


class GoalFile(Base):
    """Explicit link between a goal (optionally one of its tasks) and a file.

    Links are user-created facts, never inferred. Duplicate triples are
    rejected in code (NULL task_id would defeat a DB unique constraint)."""

    __tablename__ = "goal_files"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    owner_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    goal_id: Mapped[int] = mapped_column(
        ForeignKey("goals.id", ondelete="CASCADE"), index=True
    )
    file_id: Mapped[int] = mapped_column(
        ForeignKey("files.id", ondelete="CASCADE"), index=True
    )
    task_id: Mapped[int | None] = mapped_column(
        ForeignKey("tasks.id", ondelete="CASCADE"), nullable=True, default=None
    )
    note: Mapped[str] = mapped_column(String(500), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    goal: Mapped["Goal"] = relationship(back_populates="file_links")
    file: Mapped["File"] = relationship()
    task: Mapped["Task | None"] = relationship()
