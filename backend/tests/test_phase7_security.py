"""Phase 7: security and file-handling validation.

Every test asserts a concrete security behavior: auth enforcement, upload
limits, traversal safety, non-executable previews, explicit permanent delete,
and the AI kill switch. Uses the shared `client` fixture (isolated test DB).
"""

import io

import pytest

from app.core import config as config_module
from tests.helpers import auth_headers, register, upload


def test_oversize_upload_rejected(client, monkeypatch):
    token = register(client, email="big@example.com")
    monkeypatch.setattr(config_module.settings, "max_upload_mb", 1)
    big = io.BytesIO(b"x" * (2 * 1024 * 1024))
    r = client.post(
        "/api/files/upload", headers=auth_headers(token),
        files={"file": ("big.txt", big, "text/plain")}, data={})
    assert r.status_code == 413
    assert client.get("/api/files?q=big", headers=auth_headers(token)).json() == []


def test_path_traversal_filenames_are_neutered(client):
    token = register(client, email="trav@example.com")
    h = auth_headers(token)
    for evil in ("../../evil.txt", "..\\..\\evil.txt", "/abs/path.txt", "a/b/c.txt"):
        up = upload(client, token, filename=evil, content=b"x")
        assert up.status_code == 201, evil
        name = up.json()["original_filename"]
        assert "/" not in name and "\\" not in name, name
        dl = client.get(f"/api/files/{up.json()['id']}/download", headers=h)
        assert dl.status_code == 200 and dl.content == b"x"


def test_previews_never_execute_markup(client):
    token = register(client, email="xss@example.com")
    h = auth_headers(token)
    html = upload(client, token, filename="page.html",
                  content=b"<script>alert(1)</script><p>hi</p>")
    assert html.status_code == 201
    pv = client.get(f"/api/files/{html.json()['id']}/preview", headers=h)
    assert pv.status_code == 200
    assert pv.headers["content-type"].startswith("text/plain")
    assert pv.headers["x-content-type-options"] == "nosniff"

    svg = upload(client, token, filename="pic.svg",
                 content=b"<svg onload='alert(1)'><circle/></svg>")
    assert svg.status_code == 201
    pv2 = client.get(f"/api/files/{svg.json()['id']}/preview", headers=h)
    assert pv2.status_code == 200
    assert pv2.headers["content-type"].startswith("text/plain")

    dl = client.get(f"/api/files/{html.json()['id']}/download", headers=h)
    assert "attachment" in dl.headers["content-disposition"]


def test_auth_enforcement(client):
    assert client.get("/api/auth/me").status_code == 401
    assert client.get("/api/auth/me", headers={"Authorization": "Bearer junk"}).status_code == 401
    token = register(client, email="auth7@example.com")
    tampered = token[:-2] + ("aa" if not token.endswith("aa") else "bb")
    assert client.get("/api/auth/me", headers=auth_headers(tampered)).status_code == 401
    assert client.get("/api/auth/me", headers=auth_headers(token)).status_code == 200

    weak = client.post("/api/auth/register", json={"email": "w@example.com", "password": "short"})
    assert weak.status_code == 422
    wrong = client.post("/api/auth/login",
                        json={"email": "auth7@example.com", "password": "wrong-pass-1"})
    assert wrong.status_code == 401


def test_cross_user_isolation_folders_and_settings(client):
    owner = register(client, email="o7@example.com")
    intruder = register(client, email="i7@example.com")
    oh, ih = auth_headers(owner), auth_headers(intruder)
    folder = client.post("/api/folders", headers=oh, json={"name": "Mine"}).json()
    assert client.get(f"/api/folders/{folder['id']}", headers=ih).status_code == 404
    assert client.post(f"/api/folders/{folder['id']}/trash", headers=ih).status_code == 404

    client.patch("/api/settings", headers=oh, json={"ai_consent_external": True})
    assert client.get("/api/settings", headers=ih).json()["ai_consent_external"] is False


def test_permanent_delete_removes_bytes_and_links(client):
    token = register(client, email="del7@example.com")
    h = auth_headers(token)
    goal = client.post("/api/goals", headers=h, json={"title": "G"}).json()
    up = upload(client, token, filename="gone.txt", content=b"bye").json()
    client.post(f"/api/goals/{goal['id']}/files", headers=h, json={"file_id": up["id"]})
    client.post(f"/api/files/{up['id']}/trash", headers=h)
    assert client.get(f"/api/files/{up['id']}/download", headers=h).status_code == 200
    assert client.delete(f"/api/files/{up['id']}?permanent=true", headers=h).status_code == 200
    assert client.get(f"/api/files/{up['id']}", headers=h).status_code == 404
    assert client.get(f"/api/files/{up['id']}/download", headers=h).status_code == 404
    assert client.get(f"/api/goals/{goal['id']}", headers=h).json()["file_count"] == 0


def test_kill_switch_holds_despite_user_consent(client):
    token = register(client, email="kill@example.com")
    h = auth_headers(token)
    upload(client, token, filename="doc.txt", content=b"The quick brown fox jumps.").json()
    client.patch("/api/settings", headers=h, json={"ai_consent_external": True})
    out = client.post("/api/ask", headers=h, json={"question": "What jumps?"}).json()
    assert out["engine"] == "local"  # global AI_PROCESSING_ENABLED=false wins
    status = client.get("/api/ai/status", headers=h).json()
    assert status["external_allowed_for_user"] is False


def test_trashed_folder_rejects_uploads(client):
    token = register(client, email="trash7@example.com")
    h = auth_headers(token)
    folder = client.post("/api/folders", headers=h, json={"name": "Bin"}).json()
    client.post(f"/api/folders/{folder['id']}/trash", headers=h)
    r = upload(client, token, filename="x.txt", content=b"x", folder_id=folder["id"])
    assert r.status_code == 409


@pytest.mark.parametrize("bad", ["run.exe", "setup.msi", "evil.ps1", "lib.dll", "app.apk"])
def test_blocked_executables_rejected(client, bad):
    token = register(client, email=f"exe-{bad.replace('.', '_')}@example.com")
    r = upload(client, token, filename=bad, content=b"MZ-binary")
    assert r.status_code == 415
