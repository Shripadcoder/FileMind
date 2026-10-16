from datetime import date, datetime

from pydantic import BaseModel, Field

from app.schemas.library import FileOut


# ---------- knowledge graph ----------


class GraphNode(BaseModel):
    id: str
    kind: str
    ref_id: int
    label: str
    mime: str | None = None
    favorite: bool = False
    category: str | None = None
    goal_type: str | None = None
    status: str | None = None
    task_id: int | None = None
    goal_id: int | None = None


class GraphEdge(BaseModel):
    source: str
    target: str
    rel: str
    task_id: int | None = None
    task_title: str | None = None
    stem: str | None = None


class GraphOut(BaseModel):
    nodes: list[GraphNode]
    edges: list[GraphEdge]
    truncated: bool
    focus: str | None = None


# ---------- versions ----------


class VersionGroupOut(BaseModel):
    key: str
    stem: str
    folder_id: int | None
    folder_name: str | None = None
    extension: str
    reason: str
    source: str
    files: list[FileOut]


class CompareIn(BaseModel):
    file_id_a: int
    file_id_b: int
    max_lines: int = Field(default=500, ge=50, le=2000)


class DiffOpcode(BaseModel):
    type: str
    a: list[int]
    b: list[int]
    lines: list[str] = Field(default_factory=list)


class CompareOut(BaseModel):
    file_a: int
    file_b: int
    names: dict[str, str]
    similarity: float
    added_lines: int
    removed_lines: int
    total_a: int
    total_b: int
    truncated: bool
    opcodes: list[DiffOpcode]


# ---------- calendar / reminders ----------


class CalendarEvent(BaseModel):
    id: str
    kind: str  # task | goal | milestone | reminder | activity
    title: str
    date: str
    datetime: str | None = None
    goal_id: int | None = None
    goal_title: str | None = None
    ref_id: int | None = None


class ReminderOut(BaseModel):
    goal_id: int
    goal_title: str
    reminder_at: datetime
    target_date: date | None = None


# ---------- integrations ----------


class ProviderStatus(BaseModel):
    key: str
    label: str
    available: bool
    note: str


class IntegrationsStatusOut(BaseModel):
    providers: list[ProviderStatus]


class GitHubRepoOut(BaseModel):
    owner: str
    name: str
    description: str
    html_url: str
    language: str | None = None
    stars: int
    updated_at: str | None = None


class GitHubImportIn(BaseModel):
    username: str = Field(min_length=1, max_length=100)
    repo: str = Field(min_length=1, max_length=200)
    category: str = Field(default="", max_length=120)


class GitHubLogActivityIn(BaseModel):
    username: str = Field(min_length=1, max_length=100)
    repo: str = Field(min_length=1, max_length=200)
    goal_id: int | None = None
