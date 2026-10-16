from fastapi import APIRouter
from sqlalchemy import text

from app.db.session import engine

router = APIRouter(tags=["health"])


@router.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "filemind-api"}


@router.get("/ready")
def ready() -> dict:
    """Liveness + DB connectivity. Used by the frontend health badge."""
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return {"status": "ready", "database": "reachable"}
    except Exception as exc:  # keep the message generic; no secrets leak
        return {"status": "degraded", "database": f"unreachable: {type(exc).__name__}"}
