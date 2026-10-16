"""Phase 2 tests: auth, folders, files, taxonomy, trash, duplicates, authz.

Uses an isolated SQLite database + temp storage dir; the app's
dependency_overrides mechanism swaps get_db. Tables are created directly
(create_all is test-only; app code uses Alembic migrations).
"""

import io
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

TMP = tempfile.mkdtemp(prefix="filemind-test-")
TEST_DB = os.path.join(TMP, "test.db")
TEST_STORAGE = os.path.join(TMP, "storage")

engine = create_engine(
    f"sqlite:///{TEST_DB}",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSession = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base.metadata.create_all(engine)
with TestingSession() as db:
    ensure_system_categories(db)


def _override_db():
    db = TestingSession()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = _override_db
config_module.settings.storage_dir = TEST_STORAGE


@pytest.fixture()
def client():
    with TestClient(app) as c:
        yield c


def register(client, email="ada@example.com", password="correct-horse-9"):
    resp = client.post(
        "/api/auth/register",
        json={"email": email, "password": password, "display_name": "Ada"},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["access_token"]


def auth_headers(token):
    return {"Authorization": f"Bearer {token}"}


def upload(client, token, filename="notes.pdf", content=b"%PDF-1.4 fake", **form):
    data = {k: v for k, v in form.items() if v is not None}
    return client.post(
        "/api/files/upload",
        headers=auth_headers(token),
        files={"file": (filename, io.BytesIO(content), "application/pdf")},
        data=data,
    )


# ---------- auth ----------


def test_register_login_me(client):
    token = register(client)
    resp = client.get("/api/auth/me", headers=auth_headers(token))
    assert resp.status_code == 200
    assert resp.json()["email"] == "ada@example.com"

    bad = client.post(
        "/api/auth/login",
        json={"email": "ada@example.com", "password": "wrong-password"},
    )
    assert bad.status_code == 401


def test_duplicate_register_rejected(client):
    register(client, email="dup@example.com")
    resp = client.post(
        "/api/auth/register",
        json={"email": "dup@example.com", "password": "another-pass-1"},
    )
    assert resp.status_code == 409


def test_unauthenticated_file_access_rejected(client):
    assert client.get("/api/files").status_code == 401
    assert client.get("/api/folders").status_code == 401


# ---------- folders ----------


def test_folder_crud_and_move_validation(client):
    token = register(client, email="folders@example.com")
    h = auth_headers(token)

    root = client.post("/api/folders", headers=h, json={"name": "Courses"}).json()
    child = client.post(
        "/api/folders", headers=h, json={"name": "ML", "parent_id": root["id"]}
    ).json()
    assert child["parent_id"] == root["id"]

    # Duplicate sibling name rejected.
    dup = client.post("/api/folders", headers=h, json={"name": "ML", "parent_id": root["id"]})
    assert dup.status_code == 409

    # Cannot move a folder into itself / its own descendant.
    bad = client.patch(f"/api/folders/{root['id']}", headers=h, json={"parent_id": child["id"]})
    assert bad.status_code == 422

    # Path endpoint returns ancestors.
    got = client.get(f"/api/folders/{child['id']}", headers=h).json()
    assert [p["name"] for p in got["path"]] == ["Courses"]

    # Permanent delete requires explicit flag and an empty folder.
    assert client.delete(f"/api/folders/{root['id']}", headers=h).status_code == 400
    blocked = client.delete(f"/api/folders/{root['id']}?permanent=true", headers=h)
    assert blocked.status_code == 409
    client.delete(f"/api/folders/{child['id']}?permanent=true", headers=h).json()
    assert client.delete(f"/api/folders/{root['id']}?permanent=true", headers=h).status_code == 200


def test_folder_trash_cascades_to_children_and_files(client):
    token = register(client, email="cascade@example.com")
    h = auth_headers(token)
    root = client.post("/api/folders", headers=h, json={"name": "Root"}).json()
    sub = client.post("/api/folders", headers=h, json={"name": "Sub", "parent_id": root["id"]}).json()
    up = upload(client, token, filename="doc.txt", content=b"hello", folder_id=None)
    file_id = up.json()["id"]
    client.patch(f"/api/files/{file_id}", headers=h, json={"folder_id": sub["id"]})

    client.post(f"/api/folders/{root['id']}/trash", headers=h)
    assert client.get(f"/api/files/{file_id}", headers=h).json()["is_trashed"] is True
    assert client.get("/api/files", headers=h).json() == []
    assert len(client.get("/api/files?include_trashed=true", headers=h).json()) == 1

    client.post(f"/api/folders/{root['id']}/restore", headers=h)
    assert client.get(f"/api/files/{file_id}", headers=h).json()["is_trashed"] is False


# ---------- files ----------


def test_upload_suggests_category_and_search_filters_work(client):
    token = register(client, email="files@example.com")
    h = auth_headers(token)

    up = upload(
        client, token, filename="lecture.pdf", content=b"pdf-bytes",
        description="ML lecture", tags="ml, course", is_favorite="true",
    )
    assert up.status_code == 201, up.text
    body = up.json()
    assert body["suggested_category"] == "Education"
    assert body["suggestion_source"] == "rule"
    assert body["is_favorite"] is True
    assert sorted(body["tags"]) == ["course", "ml"]

    # Search by filename, tag, mime, favorite.
    assert len(client.get("/api/files?q=lecture", headers=h).json()) == 1
    assert len(client.get("/api/files?tag=ml", headers=h).json()) == 1
    assert len(client.get("/api/files?tag=missing", headers=h).json()) == 0
    assert len(client.get("/api/files?mime=application/pdf", headers=h).json()) == 1
    assert len(client.get("/api/files?is_favorite=true", headers=h).json()) == 1
    assert len(client.get("/api/files?category=Education", headers=h).json()) == 1

    # Manual correction of the auto-assigned category.
    patched = client.patch(
        f"/api/files/{body['id']}", headers=h, json={"category_name": "My ML Stuff"}
    ).json()
    assert patched["category_name"] == "My ML Stuff"
    cats = {c["name"] for c in client.get("/api/categories", headers=h).json()}
    assert "My ML Stuff" in cats and "Education" in cats

    # Download round-trips the exact bytes under the original filename.
    dl = client.get(f"/api/files/{body['id']}/download", headers=h)
    assert dl.status_code == 200
    assert dl.content == b"pdf-bytes"
    assert "attachment" in dl.headers["content-disposition"]
    assert "lecture.pdf" in dl.headers["content-disposition"]


def test_duplicate_detection_and_trash_recovery(client):
    token = register(client, email="dups@example.com")
    h = auth_headers(token)
    a = upload(client, token, filename="a.txt", content=b"same-bytes").json()
    b = upload(client, token, filename="b.txt", content=b"same-bytes").json()
    assert a["sha256"] == b["sha256"]
    # Stored separately: two records, both retrievable. The second upload
    # already sees the first as a duplicate.
    assert a["id"] != b["id"]
    assert a["duplicate_count"] == 0
    assert b["duplicate_count"] == 1

    groups = client.get("/api/files/duplicates", headers=h).json()
    assert len(groups) == 1 and len(groups[0]["files"]) == 2

    # Trash hides from default listing; permanent delete removes one copy.
    client.post(f"/api/files/{a['id']}/trash", headers=h)
    assert client.get("/api/files/duplicates", headers=h).json() == []
    assert client.delete(f"/api/files/{a['id']}", headers=h).status_code == 400
    client.delete(f"/api/files/{a['id']}?permanent=true", headers=h)
    assert client.get(f"/api/files/{a['id']}", headers=h).status_code == 404
    # The surviving copy keeps its bytes.
    dl = client.get(f"/api/files/{b['id']}/download", headers=h)
    assert dl.content == b"same-bytes"


def test_upload_validation_and_authorization(client):
    token = register(client, email="authz@example.com")
    other = register(client, email="other@example.com", password="other-pass-12")
    h, oh = auth_headers(token), auth_headers(other)

    blocked = upload(client, token, filename="run.exe", content=b"MZ")
    assert blocked.status_code == 415

    mine = upload(client, token, filename="mine.txt", content=b"secret").json()
    # Other users get 404 (not 403) so ids cannot be enumerated.
    assert client.get(f"/api/files/{mine['id']}", headers=oh).status_code == 404
    assert client.get(f"/api/files/{mine['id']}/download", headers=oh).status_code == 404
    assert client.delete(f"/api/files/{mine['id']}?permanent=true", headers=oh).status_code == 404

    # Path traversal in the filename cannot escape storage: stored blob exists
    # under a safe generated name and the download still works.
    evil = upload(client, token, filename="../../evil.txt", content=b"x").json()
    assert "/" not in evil["original_filename"] and "\\" not in evil["original_filename"]
    assert client.get(f"/api/files/{evil['id']}/download", headers=h).status_code == 200


def test_system_categories_read_only_and_custom_crud(client):
    token = register(client, email="cats@example.com")
    h = auth_headers(token)
    cats = client.get("/api/categories", headers=h).json()
    assert {c["name"] for c in cats} >= {
        "Education", "Projects", "Programming", "Certificates",
        "Documents", "Images", "Finance", "Personal",
    }
    system_id = next(c["id"] for c in cats if c["name"] == "Education")
    assert client.patch(f"/api/categories/{system_id}", headers=h, json={"name": "X"}).status_code == 403

    custom = client.post("/api/categories", headers=h, json={"name": "Research"}).json()
    assert client.post("/api/categories", headers=h, json={"name": "Research"}).status_code == 409
    renamed = client.patch(
        f"/api/categories/{custom['id']}", headers=h, json={"name": "Research 2"}
    ).json()
    assert renamed["name"] == "Research 2"
    assert client.delete(f"/api/categories/{custom['id']}", headers=h).status_code == 200


def test_tag_delete_detaches_from_files(client):
    token = register(client, email="tags@example.com")
    h = auth_headers(token)
    up = upload(client, token, filename="tagged.txt", content=b"tagged", tags="alpha, beta").json()
    assert sorted(up["tags"]) == ["alpha", "beta"]
    tags = {t["name"]: t["id"] for t in client.get("/api/tags", headers=h).json()}
    assert client.delete(f"/api/tags/{tags['alpha']}", headers=h).status_code == 200
    remaining = client.get(f"/api/files/{up['id']}", headers=h).json()["tags"]
    assert remaining == ["beta"]
