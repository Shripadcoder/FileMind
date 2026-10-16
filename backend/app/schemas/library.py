from datetime import datetime

from pydantic import BaseModel, Field

# ---------- Folders ----------


class FolderCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    parent_id: int | None = None
    description: str = Field(default="", max_length=2000)


class FolderUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    parent_id: int | None = None
    description: str | None = Field(default=None, max_length=2000)


class FolderOut(BaseModel):
    id: int
    parent_id: int | None
    name: str
    description: str
    is_trashed: bool
    created_at: datetime
    updated_at: datetime


class FolderWithPath(FolderOut):
    path: list["FolderOut"]


# ---------- Categories & tags ----------


class CategoryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class CategoryUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=120)


class CategoryOut(BaseModel):
    id: int
    name: str
    is_system: bool


class TagCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class TagOut(BaseModel):
    id: int
    name: str


# ---------- Files ----------


class FileUpdate(BaseModel):
    """Manual correction of metadata and AI/rule suggestions.

    Category can be set by id, or by name via category_name (creates a custom
    category when needed). Tags replace the full tag set when provided."""

    original_filename: str | None = Field(default=None, min_length=1, max_length=255)
    folder_id: int | None = None
    category_id: int | None = None
    category_name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=5000)
    is_favorite: bool | None = None
    tags: list[str] | None = None


class FileOut(BaseModel):
    id: int
    original_filename: str
    folder_id: int | None
    category_id: int | None
    category_name: str | None
    mime_type: str
    size_bytes: int
    sha256: str
    description: str
    is_favorite: bool
    tags: list[str]
    is_trashed: bool
    duplicate_count: int = 0
    created_at: datetime
    updated_at: datetime


class FileUploadOut(FileOut):
    suggested_category: str
    suggestion_source: str


class DuplicateGroup(BaseModel):
    sha256: str
    size_bytes: int
    files: list[FileOut]
