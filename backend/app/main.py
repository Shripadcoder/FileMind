import logging

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.health import router as health_router
from app.core.config import settings

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("filemind")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Log non-sensitive config only.
    logger.info("database_configured=%s", "sqlite" if "sqlite" in settings.database_url else "postgres")
    logger.info("ai_processing_enabled=%s", settings.ai_processing_enabled)
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
    return app


app = create_app()
