from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.time import utcnow
from app.db.base import Base


class DocumentContent(Base):
    """Locally extracted plain text for a file. Extraction is purely local
    (no network, no consent needed) and capped in size. Contents are treated
    as untrusted input everywhere they are used (search, prompts)."""

    __tablename__ = "document_contents"

    file_id: Mapped[int] = mapped_column(
        ForeignKey("files.id", ondelete="CASCADE"), primary_key=True
    )
    owner_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    text: Mapped[str] = mapped_column(Text, default="")
    char_count: Mapped[int] = mapped_column(Integer, default=0)
    method: Mapped[str] = mapped_column(String(30), default="text")
    # Page map: [{"page": 1, "start": 0, "end": 1234}] char offsets into text.
    page_refs: Mapped[list] = mapped_column(JSON, default=list)
    extracted_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

    file: Mapped["File"] = relationship()


class DocumentVector(Base):
    """Fixed-dimension embedding for a file, written only by external
    (API-based) embedders. The default local TF-IDF engine refits on the
    live corpus per query and never writes here — this table is the seam
    for swapping in a hosted embedding model later."""

    __tablename__ = "document_vectors"

    file_id: Mapped[int] = mapped_column(
        ForeignKey("files.id", ondelete="CASCADE"), primary_key=True
    )
    owner_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    model: Mapped[str] = mapped_column(String(120))
    dim: Mapped[int] = mapped_column(Integer)
    vector: Mapped[list] = mapped_column(JSON)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class UserAIPreference(Base):
    """Per-user AI consent. External processing of document bytes requires
    this flag AND the global AI_PROCESSING_ENABLED kill switch."""

    __tablename__ = "user_ai_preferences"

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    ai_consent_external: Mapped[bool] = mapped_column(Boolean, default=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)
