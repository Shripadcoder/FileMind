"""Rule-based file organization helpers (Phase 2).

The category suggestion here is a transparent extension map, NOT an AI model:
the API reports ``suggestion_source="rule"`` and the user can correct the
category afterwards. Learned/LLM suggestions arrive in Phase 5 behind the
AI-consent toggle and will reuse the same response fields."""

import hashlib
from typing import BinaryIO

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.models.taxonomy import Category

SYSTEM_CATEGORIES = [
    "Education",
    "Projects",
    "Programming",
    "Certificates",
    "Documents",
    "Images",
    "Finance",
    "Personal",
]

EXTENSION_CATEGORY_MAP = {
    # Education
    "pdf": "Education",
    # Programming / code
    "py": "Programming",
    "js": "Programming",
    "ts": "Programming",
    "tsx": "Programming",
    "jsx": "Programming",
    "java": "Programming",
    "c": "Programming",
    "h": "Programming",
    "cpp": "Programming",
    "go": "Programming",
    "rs": "Programming",
    "rb": "Programming",
    "php": "Programming",
    "html": "Programming",
    "css": "Programming",
    "json": "Programming",
    "xml": "Programming",
    "yml": "Programming",
    "yaml": "Programming",
    "sql": "Programming",
    "sh": "Programming",
    "ipynb": "Programming",
    # Images
    "png": "Images",
    "jpg": "Images",
    "jpeg": "Images",
    "gif": "Images",
    "webp": "Images",
    "bmp": "Images",
    "svg": "Images",
    # Documents
    "txt": "Documents",
    "md": "Documents",
    "doc": "Documents",
    "docx": "Documents",
    "odt": "Documents",
    "rtf": "Documents",
    # Spreadsheets -> Finance by default (user-correctable)
    "csv": "Finance",
    "xls": "Finance",
    "xlsx": "Finance",
    "ods": "Finance",
    # Presentations -> Projects by default (user-correctable)
    "ppt": "Projects",
    "pptx": "Projects",
    "odp": "Projects",
    # Archives -> Projects by default (user-correctable)
    "zip": "Projects",
    "tar": "Projects",
    "gz": "Projects",
    "rar": "Projects",
    "7z": "Projects",
}

MIME_CATEGORY_HINTS = {
    "image/": "Images",
    "text/x-python": "Programming",
}

# Never accepted for upload. Everything else is conservatively limited by
# ALLOWED_EXTENSIONS below; binaries we cannot preview safely are still
# stored but served only as attachment downloads (never executed, never inline
# as HTML — see the preview endpoint).
BLOCKED_EXTENSIONS = {
    "exe", "msi", "bat", "cmd", "com", "scr", "dll", "so", "dylib",
    "ps1", "vbs", "jar", "apk",
}

ALLOWED_EXTENSIONS = set(EXTENSION_CATEGORY_MAP) | {
    "pdf", "mp3", "mp4", "wav", "ttf", "woff", "woff2",
}

SUGGESTION_SOURCE = "rule"


def file_extension(filename: str) -> str:
    name = (filename or "").rsplit("/", 1)[-1].rsplit("\\", 1)[-1]
    if "." not in name:
        return ""
    return name.rsplit(".", 1)[-1].lower()


def is_allowed_filename(filename: str) -> bool:
    ext = file_extension(filename)
    return bool(ext) and ext in ALLOWED_EXTENSIONS and ext not in BLOCKED_EXTENSIONS


def suggest_category_name(filename: str, mime_type: str | None = None) -> str:
    ext = file_extension(filename)
    if ext in EXTENSION_CATEGORY_MAP:
        return EXTENSION_CATEGORY_MAP[ext]
    for prefix, category in MIME_CATEGORY_HINTS.items():
        if (mime_type or "").startswith(prefix):
            return category
    return "Personal"


def sha256_of_stream(stream: BinaryIO) -> str:
    digest = hashlib.sha256()
    stream.seek(0)
    for chunk in iter(lambda: stream.read(1024 * 1024), b""):
        digest.update(chunk)
    stream.seek(0)
    return digest.hexdigest()


def normalize_tag_name(name: str) -> str:
    return " ".join(name.strip().lower().split())


def ensure_system_categories(db: Session) -> list[Category]:
    """Insert the 8 default categories once (idempotent). Called at startup
    and in tests; never duplicates existing rows."""
    existing = {
        row.name
        for row in db.execute(
            select(Category).where(Category.is_system.is_(True))
        ).scalars()
    }
    for name in SYSTEM_CATEGORIES:
        if name not in existing:
            db.add(Category(owner_id=None, name=name, is_system=True))
    db.commit()
    return list(
        db.execute(
            select(Category).where(
                or_(Category.is_system.is_(True))
            )
        ).scalars()
    )


def find_category_for_user(db: Session, owner_id: int, name: str) -> Category | None:
    """User's own category wins; otherwise fall back to the system row."""
    own = db.execute(
        select(Category).where(Category.owner_id == owner_id, Category.name == name)
    ).scalar_one_or_none()
    if own is not None:
        return own
    return db.execute(
        select(Category).where(Category.is_system.is_(True), Category.name == name)
    ).scalar_one_or_none()
