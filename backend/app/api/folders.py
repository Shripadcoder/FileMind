from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.api.helpers import folder_to_out, get_owned_folder, not_found
from app.core.time import utcnow
from app.models.file import File
from app.models.folder import Folder
from app.models.user import User
from app.db.session import get_db
from app.schemas.library import FolderCreate, FolderOut, FolderUpdate, FolderWithPath

router = APIRouter(prefix="/folders", tags=["folders"])


def _clean_name(name: str) -> str:
    cleaned = " ".join(name.strip().split())
    if not cleaned:
        raise HTTPException(status_code=422, detail="Folder name must not be empty")
    if "/" in cleaned or "\\" in cleaned:
        raise HTTPException(status_code=422, detail="Folder name must not contain slashes")
    return cleaned


def _assert_sibling_unique(
    db: Session, user: User, name: str, parent_id: int | None, exclude_id: int | None = None
) -> None:
    query = select(Folder).where(
        Folder.owner_id == user.id,
        Folder.parent_id == parent_id,
        Folder.name == name,
    )
    if exclude_id is not None:
        query = query.where(Folder.id != exclude_id)
    if db.execute(query).scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=409, detail="A folder with this name already exists here"
        )


def _descendant_ids(db: Session, user: User, folder_id: int) -> set[int]:
    """All folder ids in the subtree rooted at folder_id (inclusive)."""
    seen = {folder_id}
    stack = [folder_id]
    while stack:
        current = stack.pop()
        children = db.execute(
            select(Folder.id).where(
                Folder.owner_id == user.id, Folder.parent_id == current
            )
        ).scalars()
        for child_id in children:
            if child_id not in seen:
                seen.add(child_id)
                stack.append(child_id)
    return seen


def _set_trash_recursive(
    db: Session, user: User, folder: Folder, trashed_at: datetime | None
) -> None:
    ids = _descendant_ids(db, user, folder.id)
    db.query(Folder).filter(Folder.id.in_(ids)).update(
        {Folder.trashed_at: trashed_at}, synchronize_session=False
    )
    db.query(File).filter(
        File.owner_id == user.id, File.folder_id.in_(ids)
    ).update({File.trashed_at: trashed_at}, synchronize_session=False)
    db.commit()


@router.get("", response_model=list[FolderOut])
def list_folders(
    parent_id: int | None = Query(default=None),
    include_trashed: bool = Query(default=False),
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    if parent_id is not None:
        get_owned_folder(db, current, parent_id)  # ownership check
    query = select(Folder).where(
        Folder.owner_id == current.id, Folder.parent_id == parent_id
    )
    if not include_trashed:
        query = query.where(Folder.trashed_at.is_(None))
    folders = db.execute(query.order_by(Folder.name)).scalars().all()
    return [folder_to_out(f) for f in folders]


@router.post("", response_model=FolderOut, status_code=status.HTTP_201_CREATED)
def create_folder(
    body: FolderCreate,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    name = _clean_name(body.name)
    if body.parent_id is not None:
        parent = get_owned_folder(db, current, body.parent_id)
        if parent.trashed_at is not None:
            raise HTTPException(status_code=409, detail="Cannot create inside a trashed folder")
    _assert_sibling_unique(db, current, name, body.parent_id)
    folder = Folder(
        owner_id=current.id,
        parent_id=body.parent_id,
        name=name,
        description=body.description.strip(),
    )
    db.add(folder)
    db.commit()
    db.refresh(folder)
    return folder_to_out(folder)


@router.get("/{folder_id}", response_model=FolderWithPath)
def get_folder(
    folder_id: int,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    folder = get_owned_folder(db, current, folder_id)
    path: list[FolderOut] = []
    ancestor = folder.parent
    while ancestor is not None:
        if ancestor.owner_id != current.id:  # corrupted tree; fail closed
            raise not_found("Folder not found")
        path.append(folder_to_out(ancestor))
        ancestor = ancestor.parent
    path.reverse()
    out = folder_to_out(folder)
    return FolderWithPath(**out.model_dump(), path=path)


@router.patch("/{folder_id}", response_model=FolderOut)
def update_folder(
    folder_id: int,
    body: FolderUpdate,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    folder = get_owned_folder(db, current, folder_id)
    if body.name is not None:
        folder.name = _clean_name(body.name)
        _assert_sibling_unique(db, current, folder.name, folder.parent_id, exclude_id=folder.id)
    if "parent_id" in body.model_fields_set:
        if body.parent_id == folder.id:
            raise HTTPException(status_code=422, detail="A folder cannot contain itself")
        if body.parent_id is not None:
            target = get_owned_folder(db, current, body.parent_id)
            if target.trashed_at is not None:
                raise HTTPException(status_code=409, detail="Cannot move into a trashed folder")
            if body.parent_id in _descendant_ids(db, current, folder.id):
                raise HTTPException(status_code=422, detail="Cannot move a folder into itself")
        _assert_sibling_unique(db, current, folder.name, body.parent_id, exclude_id=folder.id)
        folder.parent_id = body.parent_id
    if body.description is not None:
        folder.description = body.description.strip()
    db.commit()
    db.refresh(folder)
    return folder_to_out(folder)


@router.post("/{folder_id}/trash", response_model=FolderOut)
def trash_folder(
    folder_id: int,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    folder = get_owned_folder(db, current, folder_id)
    _set_trash_recursive(db, current, folder, utcnow())
    db.refresh(folder)
    return folder_to_out(folder)


@router.post("/{folder_id}/restore", response_model=FolderOut)
def restore_folder(
    folder_id: int,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    folder = get_owned_folder(db, current, folder_id)
    _set_trash_recursive(db, current, folder, None)
    db.refresh(folder)
    return folder_to_out(folder)


@router.delete("/{folder_id}")
def delete_folder(
    folder_id: int,
    permanent: bool = Query(default=False, description="Required explicit confirmation"),
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    folder = get_owned_folder(db, current, folder_id)
    if not permanent:
        raise HTTPException(
            status_code=400,
            detail="Permanent deletion requires ?permanent=true (trash first to hide it)",
        )
    child_count = db.execute(
        select(Folder.id).where(Folder.owner_id == current.id, Folder.parent_id == folder.id).limit(1)
    ).scalar_one_or_none()
    file_count = db.execute(
        select(File.id).where(File.owner_id == current.id, File.folder_id == folder.id).limit(1)
    ).scalar_one_or_none()
    if child_count is not None or file_count is not None:
        raise HTTPException(
            status_code=409,
            detail="Folder is not empty — move or delete its contents first",
        )
    db.delete(folder)
    db.commit()
    return {"id": folder_id, "deleted": True}
