"""Vector-store interface for fixed-dimension (external) embeddings.

The local TF-IDF path does not use this store — it refits on the live corpus
per query. This module exists so a hosted embedding model can persist vectors
without changing any call sites."""

from typing import Protocol

import numpy as np
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.time import utcnow
from app.models.ai import DocumentVector


class VectorStore(Protocol):
    def upsert(self, owner_id: int, file_id: int, vector: list[float], model: str) -> None: ...
    def fetch_all(self, owner_id: int, model: str) -> list[DocumentVector]: ...
    def delete_for_file(self, owner_id: int, file_id: int) -> None: ...


class DbVectorStore:
    def __init__(self, db: Session):
        self.db = db

    def upsert(self, owner_id: int, file_id: int, vector: list[float], model: str) -> None:
        row = self.db.get(DocumentVector, file_id)
        if row is None or row.owner_id != owner_id:
            if row is not None:
                self.db.delete(row)
            row = DocumentVector(owner_id=owner_id, file_id=file_id, model=model,
                                 dim=len(vector), vector=list(vector), updated_at=utcnow())
            self.db.add(row)
        else:
            row.model = model
            row.dim = len(vector)
            row.vector = list(vector)
            row.updated_at = utcnow()
        self.db.flush()

    def fetch_all(self, owner_id: int, model: str) -> list[DocumentVector]:
        return list(
            self.db.execute(
                select(DocumentVector).where(
                    DocumentVector.owner_id == owner_id, DocumentVector.model == model
                )
            ).scalars()
        )

    def delete_for_file(self, owner_id: int, file_id: int) -> None:
        row = self.db.get(DocumentVector, file_id)
        if row is not None and row.owner_id == owner_id:
            self.db.delete(row)
            self.db.flush()

    @staticmethod
    def cosine_top(query: np.ndarray, rows: list[DocumentVector], top_k: int,
                   file_ids: set[int] | None = None) -> list[tuple[int, float]]:
        scored: list[tuple[int, float]] = []
        q = query / (np.linalg.norm(query) or 1.0)
        for row in rows:
            if file_ids is not None and row.file_id not in file_ids:
                continue
            vec = np.array(row.vector, dtype=float)
            denom = np.linalg.norm(vec) or 1.0
            scored.append((row.file_id, float(np.dot(q, vec / denom))))
        scored.sort(key=lambda item: item[1], reverse=True)
        return scored[:top_k]
