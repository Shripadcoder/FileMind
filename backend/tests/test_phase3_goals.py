"""Phase 3 tests: goals, tasks, milestones, activities, dashboard.

Uses the shared `client` fixture from conftest (isolated test DB). Every
email is unique per test so tests stay independent within the shared DB.
"""

from datetime import date, timedelta

from tests.helpers import auth_headers, register, upload

TODAY = date.today()
YESTERDAY = (TODAY - timedelta(days=1)).isoformat()
TOMORROW = (TODAY + timedelta(days=1)).isoformat()
NEXT_WEEK = (TODAY + timedelta(days=6)).isoformat()


def create_goal(client, token, **kwargs):
    body = {"title": "Learn Machine Learning", "goal_type": "course", **kwargs}
    resp = client.post("/api/goals", headers=auth_headers(token), json=body)
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_goal_type_catalog(client):
    token = register(client, email="catalog@example.com")
    resp = client.get("/api/goal-types", headers=auth_headers(token))
    assert resp.status_code == 200
    catalog = {item["type"]: item for item in resp.json()}
    assert set(catalog) == {"course", "assignment", "coding", "project", "reading", "custom"}
    assert catalog["course"]["default_progress_source"] == "tasks"
    assert catalog["project"]["default_progress_source"] == "milestones"
    assert catalog["coding"]["default_unit"] == "problems"
    assert catalog["reading"]["default_unit"] == "pages"


def test_goal_crud_and_type_defaults(client):
    token = register(client, email="crud@example.com")
    h = auth_headers(token)

    goal = create_goal(client, token, category="AI", target_date=NEXT_WEEK, status="in_progress")
    assert goal["unit"] == "lectures"  # course default
    assert goal["progress_source"] == "tasks"  # course default
    assert goal["progress"]["source_used"] == "manual"  # no tasks yet: honest fallback
    assert goal["progress"]["percent"] == 0

    fetched = client.get(f"/api/goals/{goal['id']}", headers=h).json()
    assert fetched["tasks"] == [] and fetched["milestones"] == []

    patched = client.patch(
        f"/api/goals/{goal['id']}", headers=h, json={"title": "Learn ML", "priority": "high"}
    ).json()
    assert patched["title"] == "Learn ML" and patched["priority"] == "high"

    listed = client.get("/api/goals?status=in_progress", headers=h).json()
    assert any(g["id"] == goal["id"] for g in listed)
    assert client.get("/api/goals?status=completed", headers=h).json() == []

    assert client.delete(f"/api/goals/{goal['id']}", headers=h).status_code == 200
    assert client.get(f"/api/goals/{goal['id']}", headers=h).status_code == 404


def test_course_progress_derives_from_tasks(client):
    token = register(client, email="course@example.com")
    h = auth_headers(token)
    goal = create_goal(client, token, status="in_progress")
    gid = goal["id"]

    tasks = []
    for title in ("Lecture 1", "Lecture 2", "Lecture 3"):
        r = client.post(f"/api/goals/{gid}/tasks", headers=h, json={"title": title})
        assert r.status_code == 201
        tasks.append(r.json())

    detail = client.get(f"/api/goals/{gid}", headers=h).json()
    assert detail["progress"]["source_used"] == "tasks"
    assert detail["progress"]["percent"] == 0

    client.patch(f"/api/tasks/{tasks[0]['id']}", headers=h, json={"status": "done"})
    detail = client.get(f"/api/goals/{gid}", headers=h).json()
    assert detail["progress"]["percent"] == 33.3
    assert detail["progress"]["detail"] == "1 of 3 tasks done"

    auto = client.get(f"/api/goals/{gid}/activities", headers=h).json()
    assert any(a["activity_type"] == "task_completed" and a["source"] == "auto" for a in auto)


def test_project_progress_derives_from_milestones(client):
    token = register(client, email="project@example.com")
    h = auth_headers(token)
    goal = create_goal(client, token, goal_type="project", title="Build FileMind")
    assert goal["progress_source"] == "milestones"
    gid = goal["id"]

    m1 = client.post(f"/api/goals/{gid}/milestones", headers=h, json={"title": "Phase 1"}).json()
    m2 = client.post(f"/api/goals/{gid}/milestones", headers=h, json={"title": "Phase 2"}).json()
    client.patch(f"/api/milestones/{m1['id']}", headers=h, json={"status": "completed"})

    detail = client.get(f"/api/goals/{gid}", headers=h).json()
    assert detail["progress"]["source_used"] == "milestones"
    assert detail["progress"]["percent"] == 50.0
    assert detail["milestones_done"] == 1

    assert m2["status"] == "not_started"
    assert client.delete(f"/api/milestones/{m2['id']}", headers=h).status_code == 200
    detail = client.get(f"/api/goals/{gid}", headers=h).json()
    assert detail["progress"]["percent"] == 100.0  # 1 of 1


def test_coding_manual_progress_and_completion(client):
    token = register(client, email="coding@example.com")
    h = auth_headers(token)
    goal = create_goal(
        client, token, goal_type="coding", title="LeetCode 75",
        target_value=50, current_value=0, status="in_progress",
    )
    assert goal["unit"] == "problems"

    patched = client.patch(
        f"/api/goals/{goal['id']}", headers=h, json={"current_value": 35}
    ).json()
    assert patched["progress"]["percent"] == 70.0
    assert patched["progress"]["detail"] == "35 of 50 problems"

    done = client.patch(f"/api/goals/{goal['id']}", headers=h, json={"status": "completed"}).json()
    assert done["status"] == "completed" and done["health"] == "completed"
    assert done["completed_at"] is not None

    acts = client.get(f"/api/goals/{goal['id']}/activities", headers=h).json()
    types = {a["activity_type"] for a in acts}
    assert {"goal_created", "progress_updated", "goal_completed"} <= types


def test_manual_activity_logging_and_filters(client):
    token = register(client, email="activity@example.com")
    h = auth_headers(token)
    goal = create_goal(client, token, goal_type="coding", title="NeetCode")

    r = client.post("/api/activities", headers=h, json={
        "activity_type": "problem_solved", "title": "Solved Two Sum",
        "goal_id": goal["id"], "value": 3,
    })
    assert r.status_code == 201
    assert r.json()["source"] == "manual"

    assert client.post("/api/activities", headers=h, json={
        "activity_type": "made_up", "title": "x"}).status_code == 422
    assert client.post("/api/activities", headers=h, json={
        "activity_type": "note", "title": "x", "goal_id": 99999}).status_code == 404

    by_type = client.get("/api/activities?activity_type=problem_solved", headers=h).json()
    assert len(by_type) == 1 and by_type[0]["value"] == 3
    by_goal = client.get(f"/api/activities?goal_id={goal['id']}", headers=h).json()
    assert len(by_goal) == 2  # goal_created (auto) + problem_solved (manual)

    aid = by_type[0]["id"]
    assert client.delete(f"/api/activities/{aid}", headers=h).status_code == 200
    assert client.get("/api/activities?activity_type=problem_solved", headers=h).json() == []


def test_overdue_upcoming_task_views_and_goal_health(client):
    token = register(client, email="dates@example.com")
    h = auth_headers(token)
    goal = create_goal(client, token, target_date=YESTERDAY, status="in_progress")
    assert goal["health"] == "overdue"

    assert len(client.get("/api/goals?overdue=true", headers=h).json()) == 1
    assert client.get("/api/goals?overdue=false", headers=h).json() == []

    late = client.post(
        f"/api/goals/{goal['id']}/tasks", headers=h,
        json={"title": "Late task", "due_date": YESTERDAY}).json()
    soon = client.post(
        f"/api/goals/{goal['id']}/tasks", headers=h,
        json={"title": "Soon task", "due_date": TOMORROW}).json()

    overdue = client.get("/api/tasks/overdue", headers=h).json()
    assert [t["id"] for t in overdue] == [late["id"]]
    upcoming = client.get("/api/tasks/upcoming", headers=h).json()
    assert [t["id"] for t in upcoming] == [soon["id"]]

    client.patch(f"/api/tasks/{late['id']}", headers=h, json={"status": "done"})
    assert client.get("/api/tasks/overdue", headers=h).json() == []


def test_dashboard_summary_reflects_real_records(client):
    token = register(client, email="dash@example.com")
    h = auth_headers(token)

    course = create_goal(client, token, goal_type="course", title="CS50",
                         category="Study", status="in_progress", target_date=NEXT_WEEK)
    project = create_goal(client, token, goal_type="project", title="Side app",
                          category="Build", status="in_progress")
    done_goal = create_goal(client, token, goal_type="reading", title="Clean Code",
                            target_value=10, current_value=10, status="completed")
    assert done_goal["health"] == "completed"

    t1 = client.post(f"/api/goals/{course['id']}/tasks", headers=h,
                     json={"title": "Lecture 0", "due_date": TODAY.isoformat()}).json()
    t_open = client.post(f"/api/goals/{course['id']}/tasks", headers=h,
                         json={"title": "Lecture 1", "due_date": TODAY.isoformat()}).json()
    client.patch(f"/api/tasks/{t1['id']}", headers=h, json={"status": "done"})
    m = client.post(f"/api/goals/{project['id']}/milestones", headers=h,
                    json={"title": "MVP"}).json()
    client.patch(f"/api/milestones/{m['id']}", headers=h, json={"status": "completed"})

    client.post("/api/activities", headers=h, json={
        "activity_type": "problem_solved", "title": "Solved 5", "value": 5})
    up = upload(client, token, filename="paper.pdf", content=b"pdf-bytes")
    assert up.status_code == 201

    summary = client.get("/api/dashboard/summary", headers=h).json()
    assert summary["active_goals"] == 2
    assert summary["completed_goals"] == 1
    assert summary["coding"]["problems_solved_total"] == 5.0
    assert summary["coding"]["problems_this_week"] == 5.0
    assert len(summary["courses"]) == 1 and summary["courses"][0]["tasks_done"] == 1
    assert len(summary["projects"]) == 1 and summary["projects"][0]["progress"] == 100.0
    assert [f["original_filename"] for f in summary["recent_files"]] == ["paper.pdf"]
    assert any(a["activity_type"] == "file_uploaded"
               and a["details"]["file_id"] == up.json()["id"]
               for a in summary["recent_activities"])
    cats = {c["category"]: c for c in summary["progress_by_category"]}
    assert cats["Study"]["goals"] == 1 and cats["Study"]["avg_progress"] == 50.0
    today_entry = next(d for d in summary["weekly_activity"] if d["date"] == TODAY.isoformat())
    assert today_entry["count"] >= 5  # goal_created x3, task, milestone, problems, upload
    assert len(summary["activity_calendar"]) == 90
    # The open task due today is surfaced; the completed one is not.
    assert any(t["id"] == t_open["id"] for t in summary["today_items"])
    assert all(t["id"] != t1["id"] for t in summary["today_items"])


def test_goal_authorization_isolation(client):
    owner = register(client, email="owner@example.com")
    intruder = register(client, email="intruder@example.com")
    oh, ih = auth_headers(owner), auth_headers(intruder)

    goal = create_goal(client, owner)
    gid = goal["id"]
    assert client.get(f"/api/goals/{gid}", headers=ih).status_code == 404
    assert client.patch(f"/api/goals/{gid}", headers=ih, json={"title": "x"}).status_code == 404
    assert client.post(f"/api/goals/{gid}/tasks", headers=ih, json={"title": "x"}).status_code == 404
    assert client.get(f"/api/goals/{gid}/activities", headers=ih).status_code == 404

    task = client.post(f"/api/goals/{gid}/tasks", headers=oh, json={"title": "mine"}).json()
    assert client.patch(f"/api/tasks/{task['id']}", headers=ih, json={"status": "done"}).status_code == 404
    assert client.delete(f"/api/goals/{gid}", headers=ih).status_code == 404


def test_goal_delete_preserves_activity_history(client):
    token = register(client, email="history@example.com")
    h = auth_headers(token)
    goal = create_goal(client, token, title="Temporary")
    client.post("/api/activities", headers=h, json={
        "activity_type": "note", "title": "Keep this", "goal_id": goal["id"]})
    assert client.delete(f"/api/goals/{goal['id']}", headers=h).status_code == 200
    remaining = client.get("/api/activities", headers=h).json()
    assert len(remaining) == 2  # goal_created + note survive with goal_id nulled
    assert all(a["goal_id"] is None for a in remaining)
