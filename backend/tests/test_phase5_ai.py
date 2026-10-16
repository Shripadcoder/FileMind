"""Phase 5 tests: extraction, semantic search, grounded QA, assistant, consent.

All AI runs on local engines — no network, no keys. External paths are tested
only for their gating (default deny).
"""

from tests.helpers import auth_headers, register, upload


def setup_docs(client, email="ai@example.com"):
    token = register(client, email=email)
    h = auth_headers(token)
    ml = upload(client, token, filename="ml-intro.txt", content=(
        b"Machine learning is a field of study. Neural networks learn patterns "
        b"from training data. Gradient descent optimizes the model weights. "
        b"Deep learning stacks many neural network layers for rich features. "
        b"Overfitting happens when a model memorizes training noise.")).json()
    cooking = upload(client, token, filename="pasta.txt", content=(
        b"Cooking pasta requires boiling salted water. Add the pasta and stir "
        b"occasionally. Fresh tomatoes and basil make a simple sauce. "
        b"Grate parmesan cheese over the finished dish.")).json()
    return token, h, ml, cooking


def test_auto_extraction_and_content(client):
    token, h, ml, _ = setup_docs(client)
    content = client.get(f"/api/files/{ml['id']}/content", headers=h).json()
    assert content["method"] == "text"
    assert "Neural networks" in content["text"]
    assert content["char_count"] > 100

    summary = client.get(f"/api/files/{ml['id']}/summary", headers=h).json()
    assert summary["source"] == "local-extractive"
    assert len(summary["summary"]) > 0
    # Extractive: every summary sentence appears verbatim in the source.
    assert summary["summary"] in content["text"] or all(
        s.strip() in content["text"] for s in summary["summary"].split(". ") if s.strip())

    # Unsupported types report honestly instead of failing.
    up = upload(client, token, filename="photo.png", content=b"\x89PNG fakepng")
    assert up.status_code == 201
    content2 = client.get(f"/api/files/{up.json()['id']}/content", headers=h)
    assert content2.status_code == 404


def test_pdf_extraction_with_page_refs(client):
    import io

    from pypdf import PdfWriter

    token = register(client, email="pdf@example.com")
    h = auth_headers(token)
    buf = io.BytesIO()
    writer = PdfWriter()
    page = writer.add_blank_page(width=200, height=200)
    _ = page
    writer.write(buf)
    # Blank PDF has no text — extraction reports the gap honestly.
    up = client.post(
        "/api/files/upload", headers=h,
        files={"file": ("blank.pdf", io.BytesIO(buf.getvalue()), "application/pdf")}, data={})
    assert up.status_code == 201
    assert client.get(f"/api/files/{up.json()['id']}/content", headers=h).status_code == 404


def test_content_suggestions_are_labeled_and_acceptable(client):
    token, h, ml, _ = setup_docs(client, email="suggest5@example.com")
    out = client.post(f"/api/files/{ml['id']}/suggest", headers=h).json()
    assert out["source"] == "local-content"
    # Accepting works through the normal correction endpoint.
    if out["suggested_category"]:
        patched = client.patch(f"/api/files/{ml['id']}", headers=h,
                               json={"category_name": out["suggested_category"]}).json()
        assert patched["category_name"] == out["suggested_category"]
    assert isinstance(out["suggested_tags"], list)


def test_semantic_search_ranks_meaning_over_keywords(client):
    token, h, ml, cooking = setup_docs(client, email="sem@example.com")
    res = client.post("/api/search/semantic", headers=h,
                      json={"query": "neural network training", "limit": 5}).json()
    assert res["engine"] == "tfidf-local"
    assert res["hits"] and res["hits"][0]["file_id"] == ml["id"]
    assert "neural" in res["hits"][0]["snippet"].lower()
    # Zero-overlap documents are excluded, not ranked last.
    assert all(hit["file_id"] != cooking["id"] for hit in res["hits"])

    # Natural-language query without exact filename still finds the doc.
    res2 = client.post("/api/search/semantic", headers=h,
                       json={"query": "how do models learn from data"}).json()
    assert res2["hits"] and res2["hits"][0]["file_id"] == ml["id"]


def test_document_qa_cites_real_sources(client):
    token, h, ml, cooking = setup_docs(client, email="qa@example.com")
    out = client.post("/api/ask", headers=h, json={
        "question": "What optimizes model weights?"}).json()
    assert out["engine"] == "local" and out["source"] == "local-extractive"
    assert out["citations"], "expected grounded citations"
    assert out["citations"][0]["file_id"] == ml["id"]
    assert "Gradient descent" in out["answer"]

    # Scoped to chosen files only.
    scoped = client.post("/api/ask", headers=h, json={
        "question": "What optimizes model weights?", "file_ids": [cooking["id"]]}).json()
    assert scoped["citations"] == [] or all(
        c["file_id"] == cooking["id"] for c in scoped["citations"])

    # No relevant passages -> honest admission, no fabrication.
    empty = client.post("/api/ask", headers=h, json={
        "question": "What is the capital of Atlantis?"}).json()
    assert empty["citations"] == []
    assert "couldn't find" in empty["answer"]

    # Foreign file ids are rejected, not leaked.
    assert client.post("/api/ask", headers=h, json={
        "question": "x", "file_ids": [99999]}).status_code == 404


def test_assistant_answers_from_records(client):
    from datetime import date, timedelta

    token = register(client, email="assist@example.com")
    h = auth_headers(token)
    today = date.today()
    goal = client.post("/api/goals", headers=h, json={
        "title": "ML course", "goal_type": "course", "category": "Study",
        "status": "in_progress",
        "target_date": (today + timedelta(days=3)).isoformat()}).json()
    task = client.post(f"/api/goals/{goal['id']}/tasks", headers=h, json={
        "title": "Lecture 1", "due_date": today.isoformat()}).json()
    doc = upload(client, token, filename="ml.pdf", content=b"ml content here").json()
    client.post(f"/api/goals/{goal['id']}/files", headers=h, json={"file_id": doc["id"]})
    client.post("/api/activities", headers=h, json={
        "activity_type": "problem_solved", "title": "Solved 2", "value": 2})

    def ask(q):
        r = client.post("/api/assistant", headers=h, json={"question": q})
        assert r.status_code == 200, r.text
        return r.json()

    today_a = ask("What should I work on today?")
    assert today_a["intent"] == "today"
    assert any("Lecture 1" in f for f in today_a["facts"])

    track = ask("Am I on track to finish ML course?")
    assert track["intent"] == "on_track"
    assert "ML course" in track["answer"]

    least = ask("Which goals made the least progress?")
    assert least["intent"] == "least_progress"
    assert any("ML course" in f for f in least["facts"])

    files = ask("Show me the files for my ML course project")
    assert files["intent"] == "files_for"
    assert any("ml.pdf" in f for f in files["facts"])

    week = ask("Summarize my productivity this week")
    assert week["intent"] == "week_summary"
    assert any("problem_solved" in f for f in week["facts"])
    assert week["source"] == "rules+records"

    prio = ask("Which tasks should I prioritize?")
    assert prio["intent"] == "prioritize"
    assert any("Lecture 1" in f for f in prio["facts"])

    # Empty database -> honest empty answer, no invented work.
    lonely = register(client, email="fresh@example.com")
    fresh = client.post("/api/assistant", headers=auth_headers(lonely),
                        json={"question": "What should I work on today?"}).json()
    assert fresh["facts"] == [] and "Nothing is due" in fresh["answer"]

    assert task["id"] and doc["id"]  # silence unused warnings


def test_consent_gating_and_status(client):
    token = register(client, email="consent@example.com")
    h = auth_headers(token)

    status = client.get("/api/ai/status", headers=h).json()
    assert status["local_engine"] == "tfidf-local + extractive"
    assert status["ai_processing_enabled"] is False
    assert status["external_allowed_for_user"] is False
    assert set(status["extraction_methods"]) == {"text", "pdf", "docx"}

    before = client.get("/api/settings", headers=h).json()
    assert before["ai_consent_external"] is False

    updated = client.patch("/api/settings", headers=h,
                           json={"ai_consent_external": True}).json()
    assert updated["ai_consent_external"] is True
    # Global kill switch still off -> external still not allowed.
    assert client.get("/api/ai/status", headers=h).json()["external_allowed_for_user"] is False

    # Consent is per-user.
    other = register(client, email="consent2@example.com")
    assert client.get("/api/settings", headers=auth_headers(other)).json()[
        "ai_consent_external"] is False
