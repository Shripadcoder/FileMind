import mimetypes
from datetime import datetime

from fastapi import APIRouter, Depends, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse, PlainTextResponse
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.api.helpers import (
    duplicate_counts,
    file_to_out,
    get_owned_file,
    get_owned_folder,
    link_counts,
)
from app.core.config import settings
from app.core.time import utcnow
from app.services.activity_log import log_activity
from app.models.ai import DocumentContent, DocumentVector
from app.models.file import File, file_tags
from app.models.folder import Folder
from app.models.links import GoalFile
from app.models.taxonomy import Category, Tag
from app.models.user import User
from app.db.session import get_db
from app.schemas.advanced import CompareIn, CompareOut, VersionGroupOut
from app.schemas.library import DuplicateGroup, FileOut, FileUpdate, FileUploadOut
from app.services.library import (
    SUGGESTION_SOURCE,
    ensure_system_categories,
    file_extension,
    find_category_for_user,
    is_allowed_filename,
    normalize_tag_name,
    sha256_of_stream,
    suggest_category_name,
)
from app.services.storage import OversizeError, get_storage, new_stored_name, remove_blob_quietly
from app.services import versions as version_service

router = APIRouter(prefix="/files", tags=["files"])

PREVIEW_TEXT_EXTENSIONS = {
    "txt", "md", "csv", "json", "xml", "yml", "yaml", "log",
    "py", "js", "ts", "tsx", "jsx", "java", "c", "h", "cpp",
    "go", "rs", "rb", "php", "html", "css", "sql", "sh",
}
PREVIEW_MAX_BYTES = 2 * 1024 * 1024


def _display_filename(filename: str | None) -> str:
    base = (filename or "upload").rsplit("/", 1)[-1].rsplit("\\", 1)[-1].strip()
    return base[:255] or "upload"


def _resolve_tags(db: Session, user: User, raw_tags: list[str] | None) -> list[Tag]:
    if not raw_tags:
        return []
    names: list[str] = []
    for raw in raw_tags:
        for part in raw.split(","):
            name = normalize_tag_name(part)
            if name and name not in names:
                names.append(name)
    resolved: list[Tag] = []
    for name in names[:20]:
        tag = db.execute(
            select(Tag).where(Tag.owner_id == user.id, Tag.name == name)
        ).scalar_one_or_none()
        if tag is None:
            tag = Tag(owner_id=user.id, name=name[:80])
            db.add(tag)
            db.flush()
        resolved.append(tag)
    return resolved


def _as_naive(value: datetime | None) -> datetime | None:
    if value is not None and value.tzinfo is not None:
        return value.replace(tzinfo=None)
    return value


@router.post("/upload", response_model=FileUploadOut, status_code=status.HTTP_201_CREATED)
def upload_file(
    file: UploadFile,
    folder_id: int | None = Form(default=None),
    category: str | None = Form(default=None),
    description: str = Form(default=""),
    tags: str = Form(default=""),
    is_favorite: bool = Form(default=False),
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    original = _display_filename(file.filename)
    if not is_allowed_filename(original):
        raise HTTPException(
            status_code=415,
            detail=f"File type not supported: .{file_extension(original) or '?'}",
        )
    folder = None
    if folder_id is not None:
        folder = get_owned_folder(db, current, folder_id)
        if folder.trashed_at is not None:
            raise HTTPException(status_code=409, detail="Cannot upload into a trashed folder")

    stored_name = new_stored_name()
    storage = get_storage()
    max_bytes = settings.max_upload_mb * 1024 * 1024
    try:
        _, size = storage.save_stream(current.id, stored_name, file.file, max_bytes)
    except OversizeError:
        raise HTTPException(
            status_code=413,
            detail=f"File exceeds the {settings.max_upload_mb} MB upload limit",
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    with storage.open(current.id, stored_name) as blob:
        digest = sha256_of_stream(blob)

    mime_type = file.content_type or mimetypes.guess_type(original)[0] or "application/octet-stream"
    ensure_system_categories(db)

    suggestion_source = SUGGESTION_SOURCE
    if category and category.strip():
        wanted = " ".join(category.strip().split())[:120]
        category_row = find_category_for_user(db, current.id, wanted)
        if category_row is None:
            category_row = Category(owner_id=current.id, name=wanted, is_system=False)
            db.add(category_row)
            db.flush()
        suggested_name = category_row.name
        suggestion_source = "explicit"
    else:
        suggested_name = suggest_category_name(original, mime_type)
        category_row = find_category_for_user(db, current.id, suggested_name)

    record = File(
        owner_id=current.id,
        folder_id=folder.id if folder else None,
        category_id=category_row.id if category_row else None,
        original_filename=original,
        stored_name=stored_name,
        mime_type=mime_type[:128],
        size_bytes=size,
        sha256=digest,
        description=description.strip()[:5000],
        is_favorite=bool(is_favorite),
    )
    record.tags = _resolve_tags(db, current, [tags] if tags else None)
    db.add(record)
    db.flush()  # assign record.id so the activity row can reference it
    log_activity(
        db,
        owner_id=current.id,
        activity_type="file_uploaded",
        title=f"Uploaded {original}",
        value=float(size),
        details={"file_id": record.id, "size_bytes": size, "mime_type": mime_type},
    )
    db.commit()
    db.refresh(record)
    out = file_to_out(record, duplicate_counts(db, current), link_counts(db, current))
    # Best-effort local extraction (offline, capped). A failure here must
    # never fail the upload itself.
    try:
        from app.api.ai import run_extraction

        run_extraction(db, current, record)
    except Exception:  # noqa: BLE001 - extraction is auxiliary
        pass
    return FileUploadOut(
        **out.model_dump(), suggested_category=suggested_name, suggestion_source=suggestion_source
    )


@router.get("", response_model=list[FileOut])
def list_files(
    q: str | None = Query(default=None),
    folder_id: int | None = Query(default=None),
    category: str | None = Query(default=None),
    category_id: int | None = Query(default=None),
    tag: str | None = Query(default=None),
    mime: str | None = Query(default=None, description="MIME prefix, e.g. image/"),
    is_favorite: bool | None = Query(default=None),
    include_trashed: bool = Query(default=False),
    trashed_only: bool = Query(default=False),
    duplicates_only: bool = Query(default=False),
    created_from: datetime | None = Query(default=None),
    created_to: datetime | None = Query(default=None),
    sort: str = Query(default="created_at"),
    order: str = Query(default="desc"),
    limit: int = Query(default=50, le=200),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    query = select(File).where(File.owner_id == current.id)
    if trashed_only:
        query = query.where(File.trashed_at.is_not(None))
    elif not include_trashed:
        query = query.where(File.trashed_at.is_(None))
    if q:
        like = f"%{q.strip()}%"
        query = query.where(
            or_(
                File.original_filename.ilike(like),
                File.description.ilike(like),
                File.mime_type.ilike(like),
            )
        )
    if folder_id is not None:
        get_owned_folder(db, current, folder_id)  # ownership check
        query = query.where(File.folder_id == folder_id)
    if category_id is not None:
        query = query.where(File.category_id == category_id)
    elif category:
        wanted = category.strip()
        query = query.join(Category, File.category_id == Category.id).where(
            Category.name == wanted,
            or_(Category.is_system.is_(True), Category.owner_id == current.id),
        )
    if tag:
        wanted_tag = normalize_tag_name(tag)
        query = query.where(File.tags.any(Tag.name == wanted_tag))
    if mime:
        query = query.where(File.mime_type.ilike(f"{mime.strip()}%"))
    if is_favorite is not None:
        query = query.where(File.is_favorite.is_(is_favorite))
    if duplicates_only:
        dup_shas = (
            select(File.sha256)
            .where(File.owner_id == current.id, File.trashed_at.is_(None))
            .group_by(File.sha256)
            .having(func.count(File.id) > 1)
        )
        query = query.where(File.sha256.in_(dup_shas), File.trashed_at.is_(None))
    created_from = _as_naive(created_from)
    created_to = _as_naive(created_to)
    if created_from is not None:
        query = query.where(File.created_at >= created_from)
    if created_to is not None:
        query = query.where(File.created_at <= created_to)

    sort_col = {
        "created_at": File.created_at,
        "size_bytes": File.size_bytes,
        "original_filename": File.original_filename,
    }.get(sort, File.created_at)
    query = query.order_by(sort_col.asc() if order == "asc" else sort_col.desc())
    rows = db.execute(query.limit(limit).offset(offset)).scalars().all()
    counts = duplicate_counts(db, current)
    links = link_counts(db, current)
    return [file_to_out(f, counts, links) for f in rows]


@router.get("/duplicates", response_model=list[DuplicateGroup])
def list_duplicates(
    db: Session = Depends(get_db), current: User = Depends(get_current_user)
):
    dup_shas = [
        row[0]
        for row in db.execute(
            select(File.sha256)
            .where(File.owner_id == current.id, File.trashed_at.is_(None))
            .group_by(File.sha256)
            .having(func.count(File.id) > 1)
        ).all()
    ]
    if not dup_shas:
        return []
    rows = db.execute(
        select(File)
        .where(
            File.owner_id == current.id,
            File.trashed_at.is_(None),
            File.sha256.in_(dup_shas),
        )
        .order_by(File.sha256, File.created_at)
    ).scalars()
    counts = duplicate_counts(db, current)
    groups: dict[str, DuplicateGroup] = {}
    for f in rows:
        group = groups.get(f.sha256)
        if group is None:
            group = DuplicateGroup(sha256=f.sha256, size_bytes=f.size_bytes, files=[])
            groups[f.sha256] = group
        group.files.append(file_to_out(f, counts))
    return list(groups.values())


@router.get("/versions", response_model=list[VersionGroupOut])
def version_groups(
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    """Likely document versions (filename heuristic). Literal route lives here
    so it cannot be shadowed by /{file_id}."""
    files = list(db.execute(
        select(File).where(File.owner_id == current.id, File.trashed_at.is_(None))
        .order_by(File.created_at)).scalars())
    folder_names = {f.id: f.name for f in db.execute(
        select(Folder).where(Folder.owner_id == current.id)).scalars()}
    counts, links = duplicate_counts(db, current), link_counts(db, current)
    out = []
    for group in version_service.group_versions(files):
        out.append(VersionGroupOut(
            key=group["key"], stem=group["stem"], folder_id=group["folder_id"],
            folder_name=folder_names.get(group["folder_id"]),
            extension=group["extension"], reason=group["reason"], source=group["source"],
            files=[file_to_out(f, counts, links) for f in group["files"]]))
    return out


@router.post("/compare", response_model=CompareOut)
def compare_files(
    body: CompareIn,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    if body.file_id_a == body.file_id_b:
        raise HTTPException(status_code=422, detail="Choose two different files")
    file_a = get_owned_file(db, current, body.file_id_a)
    file_b = get_owned_file(db, current, body.file_id_b)
    content_a = db.get(DocumentContent, file_a.id)
    content_b = db.get(DocumentContent, file_b.id)
    missing = [name for name, content in
               ((file_a.original_filename, content_a), (file_b.original_filename, content_b))
               if content is None or content.owner_id != current.id or not content.text.strip()]
    if missing:
        raise HTTPException(
            status_code=415,
            detail=f"No extractable text for: {', '.join(missing)}. "
                   "Comparison needs extracted text (POST /files/{id}/extract).")
    diff = version_service.compare_texts(
        content_a.text, content_b.text,  # type: ignore[union-attr]
        file_a.original_filename, file_b.original_filename, max_lines=body.max_lines)
    return CompareOut(file_a=file_a.id, file_b=file_b.id, **diff)


@router.get("/{file_id}", response_model=FileOut)
def get_file(
    file_id: int,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    record = get_owned_file(db, current, file_id)
    return file_to_out(record, duplicate_counts(db, current), link_counts(db, current))


@router.patch("/{file_id}", response_model=FileOut)
def update_file(
    file_id: int,
    body: FileUpdate,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    record = get_owned_file(db, current, file_id)
    if body.original_filename is not None:
        renamed = _display_filename(body.original_filename)
        if not is_allowed_filename(renamed):
            raise HTTPException(status_code=415, detail="File type not supported")
        record.original_filename = renamed
    if "folder_id" in body.model_fields_set:
        if body.folder_id is not None:
            target = get_owned_folder(db, current, body.folder_id)
            if target.trashed_at is not None:
                raise HTTPException(status_code=409, detail="Cannot move into a trashed folder")
        record.folder_id = body.folder_id
    if body.category_id is not None or body.category_name:
        if body.category_id is not None:
            category_row = db.get(Category, body.category_id)
            if category_row is None or (
                category_row.owner_id != current.id and not category_row.is_system
            ):
                raise HTTPException(status_code=404, detail="Category not found")
        else:
            wanted = " ".join(body.category_name.strip().split())[:120]  # type: ignore[union-attr]
            category_row = find_category_for_user(db, current.id, wanted)
            if category_row is None:
                category_row = Category(owner_id=current.id, name=wanted, is_system=False)
                db.add(category_row)
                db.flush()
        record.category_id = category_row.id
    if body.description is not None:
        record.description = body.description.strip()[:5000]
    if body.is_favorite is not None:
        record.is_favorite = bool(body.is_favorite)
    if body.tags is not None:
        record.tags = _resolve_tags(db, current, body.tags)
    db.commit()
    db.refresh(record)
    return file_to_out(record, duplicate_counts(db, current), link_counts(db, current))


@router.post("/{file_id}/trash", response_model=FileOut)
def trash_file(
    file_id: int,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    record = get_owned_file(db, current, file_id)
    record.trashed_at = utcnow()
    db.commit()
    db.refresh(record)
    return file_to_out(record, None, link_counts(db, current))


@router.post("/{file_id}/restore", response_model=FileOut)
def restore_file(
    file_id: int,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    record = get_owned_file(db, current, file_id)
    record.trashed_at = None
    db.commit()
    db.refresh(record)
    return file_to_out(record, duplicate_counts(db, current), link_counts(db, current))


@router.delete("/{file_id}")
def delete_file(
    file_id: int,
    permanent: bool = Query(default=False, description="Required explicit confirmation"),
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    record = get_owned_file(db, current, file_id)
    if not permanent:
        raise HTTPException(
            status_code=400,
            detail="Permanent deletion requires ?permanent=true (trash first to hide it)",
        )
    stored_name, owner_id = record.stored_name, record.owner_id
    # Detach tag + goal links explicitly so no orphan rows remain on backends
    # without FK enforcement (e.g. SQLite without the PRAGMA listener).
    db.execute(file_tags.delete().where(file_tags.c.file_id == record.id))
    db.query(GoalFile).filter(GoalFile.file_id == record.id).delete(synchronize_session=False)
    db.query(DocumentContent).filter(DocumentContent.file_id == record.id).delete(
        synchronize_session=False)
    db.query(DocumentVector).filter(DocumentVector.file_id == record.id).delete(
        synchronize_session=False)
    db.delete(record)
    db.commit()
    # Each upload owns its blob, so no other record can reference it.
    remove_blob_quietly(owner_id, stored_name)
    return {"id": file_id, "deleted": True}


@router.get("/{file_id}/download")
def download_file(
    file_id: int,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    record = get_owned_file(db, current, file_id)
    path = _blob_path_or_404(current.id, record.stored_name)
    # Attachment + generic handling: browsers download instead of executing.
    return FileResponse(
        path,
        media_type="application/octet-stream",
        filename=record.original_filename,
        headers={"X-Content-Type-Options": "nosniff"},
    )


@router.get("/{file_id}/preview")
def preview_file(
    file_id: int,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    record = get_owned_file(db, current, file_id)
    path = _blob_path_or_404(current.id, record.stored_name)
    ext = file_extension(record.original_filename)
    mime = (record.mime_type or "").lower()

    if mime.startswith("image/") and ext in {"png", "jpg", "jpeg", "gif", "webp", "bmp"}:
        return FileResponse(
            path, media_type=mime, headers={"X-Content-Type-Options": "nosniff"}
        )
    if ext == "pdf" or mime == "application/pdf":
        return FileResponse(
            path,
            media_type="application/pdf",
            headers={
                "Content-Disposition": "inline",
                "X-Content-Type-Options": "nosniff",
            },
        )
    if mime.startswith("text/") or ext in PREVIEW_TEXT_EXTENSIONS:
        if record.size_bytes > PREVIEW_MAX_BYTES:
            raise HTTPException(status_code=413, detail="File too large to preview as text")
        # text/plain (never text/html) so embedded markup cannot execute.
        return FileResponse(
            path,
            media_type="text/plain; charset=utf-8",
            headers={"X-Content-Type-Options": "nosniff"},
        )
    if ext == "svg":
        return PlainTextResponse(
            open(path, "rb").read(PREVIEW_MAX_BYTES).decode("utf-8", errors="replace"),
            headers={"X-Content-Type-Options": "nosniff"},
        )
    raise HTTPException(
        status_code=415, detail="Preview not available for this file type — use download"
    )


def _blob_path_or_404(owner_id: int, stored_name: str) -> str:
    import os

    from app.services.storage import LocalStorageBackend

    try:
        path = LocalStorageBackend()._path(owner_id, stored_name)
    except ValueError:
        raise HTTPException(status_code=404, detail="File binary not found")
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="File binary not found")
    return path
