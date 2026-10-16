"""AI endpoints. Local engines work for every user with zero configuration;
external providers require the global kill switch AND per-user consent."""

import os
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.dashboard import build_dashboard_summary
from app.api.deps import get_current_user
from app.api.goals import serialize_goal
from app.api.helpers import get_owned_file, get_owned_folder
from app.core.config import settings
from app.db.session import get_db
from app.models.ai import DocumentContent
from app.models.file import File
from app.models.goals import Goal
from app.models.links import GoalFile
from app.models.taxonomy import Category, Tag
from app.models.user import User
from app.schemas.ai import (
    AIStatusOut,
    AskIn,
    AskOut,
    AssistantIn,
    AssistantOut,
    ContentOut,
    ExtractOut,
    SemanticHit,
    SemanticSearchIn,
    SemanticSearchOut,
    SettingsOut,
    SettingsUpdate,
    SuggestOut,
    SummaryOut,
)
from app.services.ai import assistant as assistant_engine
from app.services.ai import qa as qa_engine
from app.services.ai import suggest as suggest_engine
from app.services.ai import summarize as summarize_engine
from app.services.ai.chunking import Chunk, chunk_document
from app.services.ai.extractors import extract_text
from app.services.ai.providers import (
    ExternalLLM,
    external_allowed,
    get_consent,
    provider_configured,
    set_consent,
)
from app.services.ai.vector_store import DbVectorStore

router = APIRouter(tags=["ai"])


def _blob_path(owner_id: int, stored_name: str, filename: str) -> str:
    from app.services.storage import LocalStorageBackend

    try:
        path = LocalStorageBackend()._path(owner_id, stored_name)
    except ValueError:
        raise HTTPException(status_code=404, detail="File binary not found")
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="File binary not found")
    return path


def _extension(filename: str) -> str:
    return (filename.rsplit(".", 1)[-1].lower() if "." in filename else "")


def run_extraction(db: Session, user: User, file: File) -> ExtractOut:
    if file.trashed_at is not None:
        return ExtractOut(file_id=file.id, extracted=False, reason="file is trashed")
    path = _blob_path(user.id, file.stored_name, file.original_filename)
    result = extract_text(path, _extension(file.original_filename), settings.extraction_max_chars)
    if result is None:
        return ExtractOut(file_id=file.id, extracted=False,
                           reason="no local extractor for this file type")
    existing = db.get(DocumentContent, file.id)
    if existing is None:
        db.add(DocumentContent(
            file_id=file.id, owner_id=user.id, text=result.text,
            char_count=len(result.text), method=result.method,
            page_refs=result.page_refs))
    else:
        existing.text = result.text
        existing.char_count = len(result.text)
        existing.method = result.method
        existing.page_refs = result.page_refs
    db.commit()
    return ExtractOut(file_id=file.id, extracted=True, method=result.method,
                       char_count=len(result.text))


def _owned_contents(db: Session, user: User, file_ids: set[int] | None = None,
                    folder_id: int | None = None) -> list[tuple[File, DocumentContent]]:
    query = (
        select(File, DocumentContent)
        .join(DocumentContent, DocumentContent.file_id == File.id)
        .where(File.owner_id == user.id, File.trashed_at.is_(None))
    )
    if file_ids is not None:
        query = query.where(File.id.in_(file_ids)) if file_ids else query.where(File.id == -1)
    if folder_id is not None:
        query = query.where(File.folder_id == folder_id)
    return list(db.execute(query).all())


@router.post("/files/{file_id}/extract", response_model=ExtractOut)
def extract_file(
    file_id: int,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    return run_extraction(db, current, get_owned_file(db, current, file_id))


@router.get("/files/{file_id}/content", response_model=ContentOut)
def file_content(
    file_id: int,
    max_chars: int = 20000,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    file = get_owned_file(db, current, file_id)
    content = db.get(DocumentContent, file.id)
    if content is None or content.owner_id != current.id:
        raise HTTPException(status_code=404,
                            detail="No extracted text — POST /files/{id}/extract first")
    return ContentOut(
        file_id=file.id, filename=file.original_filename, method=content.method,
        char_count=content.char_count, page_refs=content.page_refs or [],
        text=content.text[: max(500, min(max_chars, 100_000))],
        extracted_at=content.extracted_at,
    )


@router.get("/files/{file_id}/summary", response_model=SummaryOut)
def file_summary(
    file_id: int,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    file = get_owned_file(db, current, file_id)
    content = db.get(DocumentContent, file.id)
    if content is None or content.owner_id != current.id or not content.text.strip():
        raise HTTPException(status_code=404,
                            detail="No extracted text — POST /files/{id}/extract first")
    result = summarize_engine.summarize(content.text)
    return SummaryOut(file_id=file.id, summary=result["summary"],
                       source=result["source"], sentence_count=result["sentence_count"])


@router.post("/files/{file_id}/suggest", response_model=SuggestOut)
def suggest_for_file(
    file_id: int,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    file = get_owned_file(db, current, file_id)
    content = db.get(DocumentContent, file.id)
    if content is None or content.owner_id != current.id or not content.text.strip():
        raise HTTPException(status_code=404,
                            detail="No extracted text — POST /files/{id}/extract first")

    categories = db.execute(
        select(Category).where(
            Category.is_system.is_(True) | (Category.owner_id == current.id))
    ).scalars()
    names = [c.name for c in categories]
    corpus_by_category: dict[str, list[str]] = {}
    member_rows = db.execute(
        select(Category.name, DocumentContent.text)
        .join(File, File.category_id == Category.id)
        .join(DocumentContent, DocumentContent.file_id == File.id)
        .where(File.owner_id == current.id, File.trashed_at.is_(None),
               File.id != file.id)
    ).all()
    for name, text in member_rows:
        corpus_by_category.setdefault(name, []).append(text[:2000])

    suggestion = suggest_engine.suggest_category(content.text[:20000], corpus_by_category, names)
    existing_tags = [t.name for t in db.execute(
        select(Tag).where(Tag.owner_id == current.id)).scalars()]
    tags = suggest_engine.suggest_tags(content.text[:20000], existing_tags)
    return SuggestOut(
        file_id=file.id,
        current_category=file.category.name if file.category else None,
        suggested_category=suggestion["category"] if suggestion else None,
        confidence=suggestion["confidence"] if suggestion else None,
        suggested_tags=tags["tags"],
        novel_tags=tags["novel"],
        source="local-content",
    )


@router.post("/search/semantic", response_model=SemanticSearchOut)
def semantic_search(
    body: SemanticSearchIn,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    if body.folder_id is not None:
        get_owned_folder(db, current, body.folder_id)
    pairs = _owned_contents(db, current, folder_id=body.folder_id)
    if not pairs:
        return SemanticSearchOut(query=body.query, engine="tfidf-local", hits=[])

    if external_allowed(db, current.id) and settings.embedding_model != "tfidf-local":
        return _semantic_external(db, current, body, pairs)

    chunks: list[Chunk] = []
    for file, content in pairs:
        for chunk in chunk_document(file.id, file.original_filename,
                                    content.text[:12000], content.page_refs or []):
            chunks.append(chunk)
    if not chunks:
        return SemanticSearchOut(query=body.query, engine="tfidf-local", hits=[])
    scored = qa_engine.retrieve(chunks, body.query, top_k=max(body.limit * 3, body.limit))
    best: dict[int, tuple[float, Chunk]] = {}
    for chunk, score in scored:
        if score <= 0:
            continue
        prev = best.get(chunk.file_id)
        if prev is None or score > prev[0]:
            best[chunk.file_id] = (score, chunk)
    by_id = {file.id: file for file, _ in pairs}
    hits = [
        SemanticHit(
            file_id=fid,
            filename=by_id[fid].original_filename,
            category_name=by_id[fid].category.name if by_id[fid].category else None,
            score=round(score, 3),
            snippet=chunk.text[:300],
        )
        for fid, (score, chunk) in sorted(best.items(), key=lambda kv: kv[1][0], reverse=True)[: body.limit]
    ]
    return SemanticSearchOut(query=body.query, engine="tfidf-local", hits=hits)


def _semantic_external(db: Session, user: User, body: SemanticSearchIn,
                       pairs: list) -> SemanticSearchOut:
    from app.services.ai.embeddings import ExternalEmbedder

    model = settings.embedding_model
    store = DbVectorStore(db)
    embedder = ExternalEmbedder(settings.llm_base_url, settings.llm_api_key, model)
    rows = {r.file_id: r for r in store.fetch_all(user.id, model)}
    missing = [(f, c) for f, c in pairs if f.id not in rows]
    for file, content in missing:
        vec = embedder.embed([content.text[:8000]])[0]
        store.upsert(user.id, file.id, [float(x) for x in vec], model)
    db.commit()
    rows = {r.file_id: r for r in store.fetch_all(user.id, model)}
    q = embedder.embed([body.query])[0]
    ranked = DbVectorStore.cosine_top(q, list(rows.values()), body.limit,
                                      {f.id for f, _ in pairs})
    by_id = {file.id: file for file, _ in pairs}
    text_by_id = {file.id: content.text for file, content in pairs}
    hits = [SemanticHit(file_id=fid, filename=by_id[fid].original_filename,
                         category_name=by_id[fid].category.name if by_id[fid].category else None,
                         score=round(score, 3),
                         snippet=text_by_id.get(fid, "")[:300])
            for fid, score in ranked if score > 0 and fid in by_id]
    return SemanticSearchOut(query=body.query, engine=f"external:{model}", hits=hits)


@router.post("/ask", response_model=AskOut)
def ask_documents(
    body: AskIn,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    wanted = set(body.file_ids) if body.file_ids else None
    if wanted:
        owned = set(db.execute(
            select(File.id).where(File.owner_id == current.id, File.id.in_(wanted))
        ).scalars())
        missing = wanted - owned
        if missing:
            raise HTTPException(status_code=404,
                                detail=f"Files not found: {sorted(missing)[:5]}")
    pairs = _owned_contents(db, current, file_ids=wanted)
    chunks: list[Chunk] = []
    for file, content in pairs:
        chunks.extend(chunk_document(file.id, file.original_filename,
                                     content.text[:12000], content.page_refs or []))
    scored = qa_engine.retrieve(chunks, body.question, top_k=body.top_k)
    if external_allowed(db, current.id):
        result = qa_engine.answer_external(body.question, scored, ExternalLLM())
    else:
        result = qa_engine.answer_local(body.question, scored)
    return AskOut(question=body.question, answer=result["answer"],
                   citations=result["citations"], source=result["source"],
                   engine=result["engine"])


@router.post("/assistant", response_model=AssistantOut)
def ask_assistant(
    body: AssistantIn,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    summary = build_dashboard_summary(db, current)
    goals = db.execute(
        select(Goal).where(Goal.owner_id == current.id).order_by(Goal.target_date)
    ).scalars()
    today = date.today()
    lite = []
    for goal in goals:
        serial = serialize_goal(goal, today)
        lite.append({
            "id": goal.id, "title": goal.title, "goal_type": goal.goal_type,
            "status": goal.status, "category": goal.category or "",
            "target_date": goal.target_date.isoformat() if goal.target_date else None,
            "progress": {"percent": serial.progress.percent,
                         "detail": serial.progress.detail},
            "health": serial.health,
        })
    link_rows = db.execute(
        select(GoalFile, File.original_filename).join(File, File.id == GoalFile.file_id)
        .where(GoalFile.owner_id == current.id)
    ).all()
    links: dict[int, list[dict]] = {}
    for link, filename in link_rows:
        links.setdefault(link.goal_id, []).append(
            {"filename": filename, "task_title": link.task.title if link.task else None})
    type_rows = summary.activity_by_type
    ctx = {
        "goals": lite,
        "today": [t.model_dump() for t in summary.today_items],
        "overdue_tasks": [t.model_dump() for t in summary.overdue_tasks],
        "overdue_goals": [{"id": g.id, "title": g.title, "goal_type": g.goal_type,
                            "status": g.status,
                            "target_date": g.target_date.isoformat() if g.target_date else None,
                            "progress": {"percent": g.progress.percent,
                                         "detail": g.progress.detail},
                            "health": g.health} for g in summary.overdue_goals],
        "upcoming_tasks": [t.model_dump() for t in summary.upcoming_tasks],
        "upcoming_goals": [{"id": g.id, "title": g.title,
                             "target_date": g.target_date.isoformat() if g.target_date else None}
                            for g in summary.upcoming_goals],
        "week": [{"date": d.date, "count": d.count} for d in summary.weekly_activity],
        "activity_by_type": [{"activity_type": t.activity_type, "count": t.count,
                               "total_value": t.total_value} for t in type_rows],
        "coding": {"problems_this_week": summary.coding.problems_this_week},
        "completed_count": summary.completed_goals,
        "active_count": summary.active_goals,
        "links": links,
        "today_str": today.isoformat(),
    }
    result = assistant_engine.answer(body.question, ctx)
    if external_allowed(db, current.id):
        try:
            polished = ExternalLLM().complete(
                "Reword the assistant reply concisely. Do not add, remove, or alter any "
                "facts, numbers, item names, or suggestions — only improve phrasing.",
                f"FACTS:\n" + "\n".join(result["facts"]) +
                f"\n\nSUGGESTIONS:\n" + "\n".join(result["suggestions"]) +
                f"\n\nDRAFT:\n{result['answer']}")
            result["answer"] = polished
            result["source"] = "rules+records, phrasing by external-llm"
        except Exception:
            pass
    return AssistantOut(question=body.question, intent=result["intent"],
                         answer=result["answer"], facts=result["facts"],
                         suggestions=result["suggestions"], source=result["source"])


@router.get("/ai/status", response_model=AIStatusOut)
def ai_status(
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    return AIStatusOut(
        local_engine="tfidf-local + extractive",
        extraction_methods=["text", "pdf", "docx"],
        ai_processing_enabled=settings.ai_processing_enabled,
        provider_configured=provider_configured(),
        external_allowed_for_user=external_allowed(db, current.id),
        embedding_model=settings.embedding_model,
        llm_model=settings.llm_model,
    )


@router.get("/settings", response_model=SettingsOut)
def get_settings(
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    from app.schemas.ai import SettingsOut as Out

    return Out(ai_consent_external=get_consent(db, current.id),
               ai_processing_enabled=settings.ai_processing_enabled,
               provider_configured=provider_configured())


@router.patch("/settings", response_model=SettingsOut)
def update_settings(
    body: SettingsUpdate,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    set_consent(db, current.id, body.ai_consent_external)
    return SettingsOut(ai_consent_external=body.ai_consent_external,
                       ai_processing_enabled=settings.ai_processing_enabled,
                       provider_configured=provider_configured())
