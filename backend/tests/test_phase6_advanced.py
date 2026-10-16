"""Phase 6 tests: knowledge graph, versions/compare, calendar/reminders,
integrations (offline-safe: GitHub HTTP is monkeypatched, never live)."""

from datetime import date, timedelta

import pytest

from tests.helpers import auth_headers, register, upload


def setup_world(client, email="p6@example.com"):
    token = register(client, email=email)
    h = auth_headers(token)
    folder = client.post("/api/folders", headers=h, json={"name": "Docs"}).json()
    goal = client.post("/api/goals", headers=h, json={
        "title": "Thesis", "goal_type": "project", "category": "Study",
        "status": "in_progress"}).json()
    task = client.post(f"/api/goals/{goal['id']}/tasks", headers=h,
                       json={"title": "Draft", "due_date": date.today().isoformat()}).json()
    v1 = upload(client, token, filename="thesis-v1.txt",
                content=b"Introduction\nMethods TBD.\nConclusion draft.",
                folder_id=folder["id"]).json()
    v2 = upload(client, token, filename="thesis-v2.txt",
                content=b"Introduction\nMethods done.\nResults added.\nConclusion final.",
                folder_id=folder["id"]).json()
    client.post(f"/api/goals/{goal['id']}/files", headers=h,
                json={"file_id": v2["id"], "task_id": task["id"], "note": "latest"})
    return token, h, folder, goal, task, v1, v2


def test_graph_nodes_edges_focus_and_authz(client):
    token, h, folder, goal, task, v1, v2 = setup_world(client)
    g = client.get("/api/graph", headers=h).json()
    kinds = {n["kind"] for n in g["nodes"]}
    assert {"folder", "file", "goal", "task"} <= kinds
    rels = {e["rel"] for e in g["edges"]}
    assert {"contains", "linked_to", "has_task", "version_of"} <= rels
    assert g["truncated"] is False

    by_id = {n["id"]: n for n in g["nodes"]}
    assert by_id[f"file:{v2['id']}"]["label"] == "thesis-v2.txt"

    focused = client.get(f"/api/graph?focus_kind=goal&focus_id={goal['id']}&depth=1",
                         headers=h).json()
    assert focused["focus"] == f"goal:{goal['id']}"
    assert f"goal:{goal['id']}" in {n["id"] for n in focused["nodes"]}
    assert len(focused["nodes"]) < len(g["nodes"])

    assert client.get("/api/graph?focus_kind=bogus&focus_id=1", headers=h).status_code == 422
    assert client.get("/api/graph?focus_kind=goal", headers=h).status_code == 422

    files_only = client.get("/api/graph?kinds=file,folder", headers=h).json()
    assert {n["kind"] for n in files_only["nodes"]} <= {"file", "folder"}

    intruder = register(client, email="graph-snoop@example.com")
    other = client.get("/api/graph", headers=auth_headers(intruder)).json()
    assert other["nodes"] == [] and other["edges"] == []


def test_version_groups_and_compare(client):
    token, h, folder, goal, task, v1, v2 = setup_world(client, email="ver@example.com")

    groups = client.get("/api/files/versions", headers=h).json()
    assert len(groups) == 1
    group = groups[0]
    assert group["stem"] == "thesis" and group["source"] == "filename-heuristic"
    assert [f["original_filename"] for f in group["files"]] == ["thesis-v1.txt", "thesis-v2.txt"]

    diff = client.post("/api/files/compare", headers=h, json={
        "file_id_a": v1["id"], "file_id_b": v2["id"]}).json()
    assert 0 < diff["similarity"] < 1
    assert diff["added_lines"] > 0 and diff["removed_lines"] > 0
    types = {op["type"] for op in diff["opcodes"]}
    assert {"added", "removed"} <= types

    assert client.post("/api/files/compare", headers=h, json={
        "file_id_a": v1["id"], "file_id_b": v1["id"]}).status_code == 422
    png = upload(client, token, filename="img.png", content=b"\x89PNG x").json()
    r = client.post("/api/files/compare", headers=h, json={
        "file_id_a": v1["id"], "file_id_b": png["id"]})
    assert r.status_code == 415


def test_calendar_and_reminders(client):
    token, h, folder, goal, task, v1, v2 = setup_world(client, email="cal@example.com")
    today = date.today()
    client.patch(f"/api/goals/{goal['id']}", headers=h, json={
        "target_date": (today + timedelta(days=2)).isoformat(),
        "reminder_at": (today + timedelta(days=1)).isoformat() + "T09:00:00"})

    events = client.get(
        f"/api/calendar?start={today.isoformat()}&end={(today + timedelta(days=7)).isoformat()}",
        headers=h).json()
    by_kind = {}
    for e in events:
        by_kind.setdefault(e["kind"], []).append(e)
    assert any(t["title"] == "Draft" for t in by_kind.get("task", []))
    assert any("Thesis" in g["title"] for g in by_kind.get("goal", []))
    assert any("Thesis" in r["title"] for r in by_kind.get("reminder", []))
    assert any(e["goal_id"] == goal["id"] for e in events)

    tasks_only = client.get(
        f"/api/calendar?start={today.isoformat()}&end={(today + timedelta(days=7)).isoformat()}"
        f"&kinds=task", headers=h).json()
    assert {e["kind"] for e in tasks_only} == {"task"}
    assert client.get("/api/calendar?kinds=bogus", headers=h).status_code == 422

    reminders = client.get("/api/reminders?days=7", headers=h).json()
    assert len(reminders) == 1 and reminders[0]["goal_id"] == goal["id"]


class FakeResponse:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self._payload = payload

    def json(self):
        return self._payload


def test_integrations_status_lists_provider_posture(client):
    token = register(client, email="integ@example.com")
    h = auth_headers(token)
    status = client.get("/api/integrations/status", headers=h).json()
    by_key = {p["key"]: p for p in status["providers"]}
    assert by_key["github"]["available"] is True
    assert by_key["leetcode"]["available"] is False
    assert "manual" in by_key["leetcode"]["note"].lower()
    assert by_key["courses"]["available"] is False


def test_github_import_and_log_activity_mocked(client, monkeypatch):
    import app.services.integrations.github as gh

    token = register(client, email="gh@example.com")
    h = auth_headers(token)

    repos_payload = [{
        "name": "demo", "description": "Demo repo", "html_url": "https://github.com/octocat/demo",
        "language": "Python", "stargazers_count": 42, "updated_at": "2024-01-01T00:00:00Z",
        "owner": {"login": "octocat"}}]
    commits_payload = [{
        "sha": "abc123def456", "html_url": "https://github.com/octocat/demo/commit/abc123",
        "commit": {"message": "Fix bug\n\nLong body",
                   "author": {"name": "Octo", "date": "2024-02-01T00:00:00Z"}}}]

    def fake_get(url, **kwargs):
        if url.endswith("/users/octocat/repos?per_page=100&sort=updated"):
            return FakeResponse(200, repos_payload)
        if url.endswith("/repos/octocat/demo/commits?per_page=1"):
            return FakeResponse(200, commits_payload)
        return FakeResponse(404, {"message": "not found"})

    monkeypatch.setattr(gh.httpx, "get", fake_get)

    repos = client.get("/api/integrations/github/repos?username=octocat", headers=h).json()
    assert len(repos) == 1 and repos[0]["stars"] == 42

    imported = client.post("/api/integrations/github/import", headers=h, json={
        "username": "octocat", "repo": "demo", "category": "Build"}).json()
    assert imported["goal_type"] == "project" and imported["title"] == "demo"
    assert imported["external_links"][0]["url"] == "https://github.com/octocat/demo"

    logged = client.post("/api/integrations/github/log-activity", headers=h, json={
        "username": "octocat", "repo": "demo", "goal_id": imported["id"]}).json()
    assert logged["activity_type"] == "code_commit"
    assert "Fix bug" in logged["title"] and logged["goal_id"] == imported["id"]

    assert client.post("/api/integrations/github/import", headers=h, json={
        "username": "octocat", "repo": "missing"}).status_code == 404


def test_github_upstream_failures_surface_cleanly(client, monkeypatch):
    import app.services.integrations.github as gh

    token = register(client, email="ghfail@example.com")
    h = auth_headers(token)

    monkeypatch.setattr(gh.httpx, "get", lambda url, **kw: FakeResponse(404, {}))
    assert client.get("/api/integrations/github/repos?username=nobody", headers=h).status_code == 404

    def boom(url, **kw):
        raise gh.httpx.ConnectError("offline")

    monkeypatch.setattr(gh.httpx, "get", boom)
    r = client.get("/api/integrations/github/repos?username=octocat", headers=h)
    assert r.status_code == 502 and "unreachable" in r.json()["detail"]

    assert client.get("/api/integrations/github/repos?username=not a user!", headers=h).status_code in (404, 422)
