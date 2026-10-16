"""Fact-only activity writer. Callers create the Activity row alongside the
mutation that caused it and commit once; nothing is ever logged speculatively."""

from datetime import datetime

from sqlalchemy.orm import Session

from app.core.time import utcnow
from app.models.activity import Activity


def log_activity(
    db: Session,
    *,
    owner_id: int,
    activity_type: str,
    title: str,
    description: str = "",
    goal_id: int | None = None,
    value: float = 0.0,
    details: dict | None = None,
    source: str = "auto",
    occurred_at: datetime | None = None,
) -> Activity:
    occurred = occurred_at or utcnow()
    if occurred.tzinfo is not None:
        occurred = occurred.replace(tzinfo=None)
    activity = Activity(
        owner_id=owner_id,
        goal_id=goal_id,
        activity_type=activity_type,
        title=title[:255],
        description=description[:2000],
        value=max(value, 0.0),
        details=details or {},
        source=source,
        occurred_at=occurred,
    )
    db.add(activity)
    db.flush()
    return activity
