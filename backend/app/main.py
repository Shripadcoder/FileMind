import logging

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import app.models  # noqa: F401  (register tables on Base.metadata for Alembic/migrations)
from app.api.activities import router as activities_router
from app.api.auth import router as auth_router
from app.api.dashboard import router as dashboard_router
from app.api.files import router as files_router
from app.api.folders import router as folders_router
from app.api.goals import router as goals_router
from app.api.links import router as links_router
from app.api.health import router as health_router
from app.api.taxonomy import router as taxonomy_router
from app.core.config import settings

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("filemind")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Log non-sensitive config only.
    logger.info("database_configured=%s", "sqlite" if "sqlite" in settings.database_url else "postgres")
    logger.info("ai_processing_enabled=%s", settings.ai_processing_enabled)
    # Seed the 8 default categories; never fail startup if the DB is down
    # (/api/ready still reports degraded in that case).
    try:
        from app.db.session import SessionLocal
        from app.services.library import ensure_system_categories

        db = SessionLocal()
        try:
            ensure_system_categories(db)
        finally:
            db.close()
    except Exception as exc:  # noqa: BLE001 - startup must not crash on DB issues
        logger.warning("category seeding skipped: %s", type(exc).__name__)
    yield


def create_app() -> FastAPI:
    app = FastAPI(title=settings.app_name, lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(health_router, prefix="/api")
    app.include_router(auth_router, prefix="/api")
    app.include_router(folders_router, prefix="/api")
    app.include_router(files_router, prefix="/api")
    app.include_router(goals_router, prefix="/api")
    app.include_router(links_router, prefix="/api")
    app.include_router(activities_router, prefix="/api")
    app.include_router(dashboard_router, prefix="/api")
    app.include_router(taxonomy_router, prefix="/api")
    return app


app = create_app()
