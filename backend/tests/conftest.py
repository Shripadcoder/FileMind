"""Shared fixtures for the backend test suite.

One isolated SQLite database + temp storage dir for the whole run. The
`client` fixture swaps the app's get_db dependency per test and restores it
afterwards, so test modules never interfere with each other (or the dev DB).
"""

import os
import tempfile

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core import config as config_module
from app.db.base import Base
from app.db.session import get_db
from app.main import app
from app.services.library import ensure_system_categories

TMP = tempfile.mkdtemp(prefix="filemind-suite-")
TEST_DB = os.path.join(TMP, "test.db")
TEST_STORAGE = os.path.join(TMP, "storage")

engine = create_engine(
    f"sqlite:///{TEST_DB}",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSession = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base.metadata.create_all(engine)
with TestingSession() as _db:
    ensure_system_categories(_db)


def _override_db():
    db = TestingSession()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture()
def client():
    previous_storage = config_module.settings.storage_dir
    previous_override = app.dependency_overrides.get(get_db)
    app.dependency_overrides[get_db] = _override_db
    config_module.settings.storage_dir = TEST_STORAGE
    try:
        with TestClient(app) as c:
            yield c
    finally:
        if previous_override is None:
            app.dependency_overrides.pop(get_db, None)
        else:
            app.dependency_overrides[get_db] = previous_override
        config_module.settings.storage_dir = previous_storage
