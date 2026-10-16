from datetime import datetime

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Table,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.time import utcnow
from app.db.base import Base

file_tags = Table(
    "file_tags",
    Base.metadata,
    Column("file_id", ForeignKey("files.id", ondelete="CASCADE"), primary_key=True),
    Column("tag_id", ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True),
)


class File(Base):
    """Relational metadata only — binaries live in the storage backend keyed by
    stored_name (a random uuid hex). original_filename is display-only and is
    never used as a filesystem path."""

    __tablename__ = "files"
    __table_args__ = (
        Index("ix_files_owner_folder", "owner_id", "folder_id"),
        Index("ix_files_owner_sha", "owner_id", "sha256"),
        Index("ix_files_owner_name", "owner_id", "original_filename"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    owner_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    folder_id: Mapped[int | None] = mapped_column(
        ForeignKey("folders.id", ondelete="SET NULL"), nullable=True, default=None
    )
    category_id: Mapped[int | None] = mapped_column(
        ForeignKey("categories.id", ondelete="SET NULL"), nullable=True, default=None
    )
    original_filename: Mapped[str] = mapped_column(String(255))
    stored_name: Mapped[str] = mapped_column(String(64), unique=True)
    mime_type: Mapped[str] = mapped_column(String(128), default="application/octet-stream")
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    sha256: Mapped[str] = mapped_column(String(64), index=True)
    description: Mapped[str] = mapped_column(Text, default="")
    is_favorite: Mapped[bool] = mapped_column(Boolean, default=False)
    trashed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, default=None)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=utcnow, onupdate=utcnow
    )

    owner: Mapped["User"] = relationship(back_populates="files")
    folder: Mapped["Folder | None"] = relationship()
    category: Mapped["Category | None"] = relationship()
    tags: Mapped[list["Tag"]] = relationship(secondary=file_tags)
