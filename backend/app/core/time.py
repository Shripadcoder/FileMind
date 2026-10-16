from datetime import datetime, timezone


def utcnow() -> datetime:
    """Naive UTC now. Naive datetimes keep SQLite/Postgres comparisons and
    ordering consistent without timezone-aware parsing in every query."""
    return datetime.now(timezone.utc).replace(tzinfo=None)
