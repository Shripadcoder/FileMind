"""Phase 4 tests: goal <-> file links (goal-level and task-level).

Uses the shared `client` fixture from conftest (isolated test DB).
"""

from tests.helpers import auth_headers, register, upload


def setup_link(client, email="links@example.com", goal_category="Study"):
    token = register(client, email=email)
    h = auth_headers(token)
    goal = client.post("/api/goals", headers=h, json={
        "title": "ML course", "goal_type": "course",
        "category": goal_category, "status": "in_progress",
    }).json()
    up = upload(client, token, filename="lecture.pdf", content=b"pdf-bytes")
    assert up.status_code == 201
    return token, h, goal, up.json()


def test_link_unlink_goal_file(client):
    token, h, goal, file = setup_link(client)
    gid, fid = goal["id"], file["id"]

    r = client.post(f"/api/goals/{gid}/files", headers=h,
                    json={"file_id": fid, "note": "Week 1 reading"})
    assert r.status_code == 201, r.text
    link = r.json()
    assert link["file"]["id"] == fid and link["task_id"] is None
    assert link["note"] == "Week 1 reading"

    # Duplicate link rejected.
    assert client.post(f"/api/goals/{gid}/files", headers=h,
                       json={"file_id": fid}).status_code == 409

    # Goal detail carries links + counts.
    detail = client.get(f"/api/goals/{gid}", headers=h).json()
    assert detail["file_count"] == 1
    assert [lf["file"]["id"] for lf in detail["linked_files"]] == [fid]

    # File side shows the goal and the count.
    file_goals = client.get(f"/api/files/{fid}/goals", headers=h).json()
    assert len(file_goals) == 1 and file_goals[0]["goal_title"] == "ML course"
    assert client.get(f"/api/files/{fid}", headers=h).json()["goal_count"] == 1

    # Unlink, then unlinking again is 404.
    assert client.delete(f"/api/goals/{gid}/files/{fid}", headers=h).status_code == 200
    assert client.delete(f"/api/goals/{gid}/files/{fid}", headers=h).status_code == 404
    assert client.get(f"/api/goals/{gid}", headers=h).json()["file_count"] == 0


def test_task_level_links(client):
    token, h, goal, file = setup_link(client, email="tasklinks@example.com")
    gid, fid = goal["id"], file["id"]
    task = client.post(f"/api/goals/{gid}/tasks", headers=h,
                       json={"title": "Lecture 1"}).json()

    # Task-level and goal-level links to the same file coexist.
    t = client.post(f"/api/goals/{gid}/files", headers=h,
                    json={"file_id": fid, "task_id": task["id"]}).json()
    assert t["task_id"] == task["id"] and t["task_title"] == "Lecture 1"
    g = client.post(f"/api/goals/{gid}/files", headers=h,
                    json={"file_id": fid}).json()
    assert g["task_id"] is None

    detail = client.get(f"/api/goals/{gid}", headers=h).json()
    assert detail["file_count"] == 2
    assert client.get(f"/api/files/{fid}", headers=h).json()["goal_count"] == 2

    # Task from another goal is rejected.
    other = client.post("/api/goals", headers=h, json={
        "title": "Other", "goal_type": "custom"}).json()
    foreign_task = client.post(f"/api/goals/{other['id']}/tasks", headers=h,
                               json={"title": "Foreign"}).json()
    r = client.post(f"/api/goals/{gid}/files", headers=h,
                    json={"file_id": fid, "task_id": foreign_task["id"]})
    assert r.status_code == 422

    # Deleting the task removes only its own link.
    assert client.delete(f"/api/tasks/{task['id']}", headers=h).status_code == 200
    assert client.get(f"/api/goals/{gid}", headers=h).json()["file_count"] == 1


def test_link_validation_and_authorization(client):
    token, h, goal, file = setup_link(client, email="validation@example.com")
    intruder = register(client, email="snoop@example.com")
    ih = auth_headers(intruder)
    gid, fid = goal["id"], file["id"]

    assert client.post("/api/goals/99999/files", headers=h,
                       json={"file_id": fid}).status_code == 404
    assert client.post(f"/api/goals/{gid}/files", headers=h,
                       json={"file_id": 99999}).status_code == 404
    assert client.post(f"/api/goals/{gid}/files", headers=h,
                       json={"file_id": fid, "task_id": 99999}).status_code == 404
    assert client.get(f"/api/goals/{gid}/files", headers=ih).status_code == 404
    assert client.get(f"/api/files/{fid}/goals", headers=ih).status_code == 404
    assert client.post(f"/api/goals/{gid}/files", headers=ih,
                       json={"file_id": fid}).status_code == 404

    # Trashed files cannot be linked.
    client.post(f"/api/files/{fid}/trash", headers=h)
    r = client.post(f"/api/goals/{gid}/files", headers=h, json={"file_id": fid})
    assert r.status_code == 409
    client.post(f"/api/files/{fid}/restore", headers=h)
    assert client.post(f"/api/goals/{gid}/files", headers=h,
                       json={"file_id": fid}).status_code == 201


def test_category_suggestions_in_goal_detail(client):
    token, h, goal, file = setup_link(client, email="suggest@example.com")
    gid = goal["id"]
    # lecture.pdf was auto-categorized as Education, not Study — no suggestion.
    assert client.get(f"/api/goals/{gid}", headers=h).json()["suggested_files"] == []

    notes = upload(client, token, filename="ml-notes.txt", content=b"notes",
                   category="Study").json()
    assert notes["category_name"] == "Study"
    detail = client.get(f"/api/goals/{gid}", headers=h).json()
    assert [f["id"] for f in detail["suggested_files"]] == [notes["id"]]

    # Linking removes it from suggestions; goal without category gets none.
    client.post(f"/api/goals/{gid}/files", headers=h, json={"file_id": notes["id"]})
    detail = client.get(f"/api/goals/{gid}", headers=h).json()
    assert detail["suggested_files"] == []
    uncategorized = client.post("/api/goals", headers=h, json={
        "title": "No category", "goal_type": "custom"}).json()
    assert client.get(f"/api/goals/{uncategorized['id']}",
                      headers=h).json()["suggested_files"] == []


def test_deletes_clean_up_links(client):
    token, h, goal, file = setup_link(client, email="cleanup@example.com")
    gid, fid = goal["id"], file["id"]
    client.post(f"/api/goals/{gid}/files", headers=h, json={"file_id": fid})

    # Permanent file delete removes the link; goal detail reflects it.
    client.post(f"/api/files/{fid}/trash", headers=h)
    assert client.delete(f"/api/files/{fid}?permanent=true", headers=h).status_code == 200
    assert client.get(f"/api/goals/{gid}", headers=h).json()["file_count"] == 0

    # Goal delete removes links the other way.
    file2 = upload(client, token, filename="other.txt", content=b"other").json()
    goal2 = client.post("/api/goals", headers=h, json={
        "title": "Doomed", "goal_type": "custom"}).json()
    client.post(f"/api/goals/{goal2['id']}/files", headers=h, json={"file_id": file2["id"]})
    assert client.delete(f"/api/goals/{goal2['id']}", headers=h).status_code == 200
    assert client.get(f"/api/files/{file2['id']}", headers=h).json()["goal_count"] == 0
