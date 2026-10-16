from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.user import User
from app.schemas.advanced import GraphOut
from app.services.graph import build_graph

router = APIRouter(tags=["advanced"])

NODE_KINDS = {"folder", "file", "goal", "task", "tag", "category"}


@router.get("/graph", response_model=GraphOut)
def knowledge_graph(
    focus_kind: str | None = Query(default=None),
    focus_id: int | None = Query(default=None),
    depth: int = Query(default=2, ge=0, le=3),
    kinds: str | None = Query(default=None, description="Comma-separated node kinds"),
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    if focus_kind is not None and focus_kind not in NODE_KINDS:
        raise HTTPException(status_code=422, detail=f"Unknown node kind: {focus_kind}")
    if (focus_kind is None) != (focus_id is None):
        raise HTTPException(status_code=422, detail="focus_kind and focus_id go together")
    wanted: set[str] | None = None
    if kinds:
        wanted = {k.strip() for k in kinds.split(",") if k.strip()}
        unknown = wanted - NODE_KINDS
        if unknown:
            raise HTTPException(status_code=422, detail=f"Unknown kinds: {sorted(unknown)}")
    return build_graph(db, current, focus_kind, focus_id, depth, wanted)
