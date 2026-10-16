from datetime import datetime

from pydantic import BaseModel, Field

from app.models.activity import ACTIVITY_TYPES


class ActivityCreate(BaseModel):
    activity_type: str
    title: str = Field(min_length=1, max_length=255)
    description: str = Field(default="", max_length=2000)
    goal_id: int | None = None
    value: float = Field(default=0.0, ge=0)
    details: dict = Field(default_factory=dict)
    occurred_at: datetime | None = None


class ActivityOut(BaseModel):
    id: int
    goal_id: int | None
    goal_title: str | None = None
    activity_type: str
    title: str
    description: str
    value: float
    details: dict
    source: str
    occurred_at: datetime
    created_at: datetime


def validate_activity_type(value: str) -> None:
    from fastapi import HTTPException

    if value not in ACTIVITY_TYPES:
        raise HTTPException(status_code=422, detail=f"Unknown activity type: {value}")
