"""Shared ownership lookups and serializers for the library routers.

Every lookup scopes by owner_id and raises 404 for foreign or missing rows,
so users can never enumerate another user's files or folders."""

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.file import File
from app.models.folder import Folder
from app.models.user import User
from app.schemas.library import FileOut, FolderOut


def not_found(detail: str = "Not found") -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=detail)


def get_owned_folder(db: Session, user: User, folder_id: int) -> Folder:
    folder = db.execute(
        select(Folder).where(Folder.id == folder_id, Folder.owner_id == user.id)
    ).scalar_one_or_none()
    if folder is None:
        raise not_found("Folder not found")
    return folder


def get_owned_file(db: Session, user: User, file_id: int) -> File:
    file = db.execute(
        select(File).where(File.id == file_id, File.owner_id == user.id)
    ).scalar_one_or_none()
    if file is None:
        raise not_found("File not found")
    return file


def folder_to_out(folder: Folder) -> FolderOut:
    return FolderOut(
        id=folder.id,
        parent_id=folder.parent_id,
        name=folder.name,
        description=folder.description or "",
        is_trashed=folder.trashed_at is not None,
        created_at=folder.created_at,
        updated_at=folder.updated_at,
    )


def duplicate_counts(db: Session, user: User) -> dict[str, int]:
    """Map sha256 -> number of the user's non-trashed files with that hash."""
    rows = db.execute(
        select(File.sha256, func.count(File.id))
        .where(File.owner_id == user.id, File.trashed_at.is_(None))
        .group_by(File.sha256)
    ).all()
    return {sha: count for sha, count in rows}


def link_counts(db: Session, user: User) -> dict[int, int]:
    """Map file_id -> number of goal/task links pointing at the user's files."""
    from app.models.links import GoalFile

    rows = db.execute(
        select(GoalFile.file_id, func.count(GoalFile.id))
        .where(GoalFile.owner_id == user.id)
        .group_by(GoalFile.file_id)
    ).all()
    return {file_id: count for file_id, count in rows}


def file_to_out(
    file: File,
    counts: dict[str, int] | None = None,
    links: dict[int, int] | None = None,
) -> FileOut:
    return FileOut(
        id=file.id,
        original_filename=file.original_filename,
        folder_id=file.folder_id,
        category_id=file.category_id,
        category_name=file.category.name if file.category is not None else None,
        mime_type=file.mime_type,
        size_bytes=file.size_bytes,
        sha256=file.sha256,
        description=file.description or "",
        is_favorite=file.is_favorite,
        tags=sorted(tag.name for tag in file.tags),
        is_trashed=file.trashed_at is not None,
        duplicate_count=(counts.get(file.sha256, 1) - 1) if counts else 0,
        goal_count=links.get(file.id, 0) if links else 0,
        created_at=file.created_at,
        updated_at=file.updated_at,
    )
