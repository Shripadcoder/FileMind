from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.api.goals import get_owned_goal, get_owned_task
from app.api.helpers import duplicate_counts, file_to_out, get_owned_file, link_counts
from app.db.session import get_db
from app.models.goals import Goal
from app.models.links import GoalFile
from app.models.user import User
from app.schemas.goals import GoalFileLinkCreate, GoalLinkOut, LinkedFileOut

router = APIRouter(tags=["links"])

SUGGESTION_SOURCE = "category-match"


def serialize_link(link: GoalFile, counts: dict, links: dict) -> LinkedFileOut:
    return LinkedFileOut(
        file=file_to_out(link.file, counts, links),
        task_id=link.task_id,
        task_title=link.task.title if link.task is not None else None,
        note=link.note or "",
        created_at=link.created_at,
    )


def goal_links(db: Session, user: User, goal: Goal) -> list[GoalFile]:
    return list(
        db.execute(
            select(GoalFile)
            .where(GoalFile.goal_id == goal.id, GoalFile.owner_id == user.id)
            .order_by(GoalFile.created_at)
        ).scalars()
    )


def linked_file_ids(db: Session, user: User, goal_id: int) -> set[int]:
    return set(
        db.execute(
            select(GoalFile.file_id).where(
                GoalFile.goal_id == goal_id, GoalFile.owner_id == user.id
            )
        ).scalars()
    )


@router.post("/goals/{goal_id}/files", response_model=LinkedFileOut,
             status_code=status.HTTP_201_CREATED)
def link_file_to_goal(
    goal_id: int,
    body: GoalFileLinkCreate,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    goal = get_owned_goal(db, current, goal_id)
    file = get_owned_file(db, current, body.file_id)
    if file.trashed_at is not None:
        raise HTTPException(status_code=409, detail="Cannot link a trashed file — restore it first")
    task = None
    if body.task_id is not None:
        task = get_owned_task(db, current, body.task_id)
        if task.goal_id != goal.id:
            raise HTTPException(status_code=422, detail="Task does not belong to this goal")

    existing = db.execute(
        select(GoalFile).where(
            GoalFile.owner_id == current.id,
            GoalFile.goal_id == goal.id,
            GoalFile.file_id == file.id,
            GoalFile.task_id.is_(None) if task is None else GoalFile.task_id == task.id,
        )
    ).scalar_one_or_none()
    if existing is not None:
        where = f"task '{task.title}'" if task else "this goal"
        raise HTTPException(status_code=409, detail=f"File is already linked to {where}")

    link = GoalFile(
        owner_id=current.id, goal_id=goal.id, file_id=file.id,
        task_id=task.id if task else None, note=body.note.strip(),
    )
    db.add(link)
    db.commit()
    db.refresh(link)
    return serialize_link(link, duplicate_counts(db, current), link_counts(db, current))


@router.get("/goals/{goal_id}/files", response_model=list[LinkedFileOut])
def list_goal_files(
    goal_id: int,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    goal = get_owned_goal(db, current, goal_id)
    links = goal_links(db, current, goal)
    counts, linkmap = duplicate_counts(db, current), link_counts(db, current)
    return [serialize_link(link, counts, linkmap) for link in links]


@router.delete("/goals/{goal_id}/files/{file_id}")
def unlink_file_from_goal(
    goal_id: int,
    file_id: int,
    task_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    get_owned_goal(db, current, goal_id)  # ownership check (404 for foreign goals)
    query = select(GoalFile).where(
        GoalFile.owner_id == current.id,
        GoalFile.goal_id == goal_id,
        GoalFile.file_id == file_id,
        GoalFile.task_id.is_(None) if task_id is None else GoalFile.task_id == task_id,
    )
    link = db.execute(query).scalar_one_or_none()
    if link is None:
        raise HTTPException(status_code=404, detail="Link not found")
    db.delete(link)
    db.commit()
    return {"goal_id": goal_id, "file_id": file_id, "deleted": True}


@router.get("/files/{file_id}/goals", response_model=list[GoalLinkOut])
def list_file_goals(
    file_id: int,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    file = get_owned_file(db, current, file_id)
    links = db.execute(
        select(GoalFile)
        .where(GoalFile.file_id == file.id, GoalFile.owner_id == current.id)
        .order_by(GoalFile.created_at)
    ).scalars()
    return [
        GoalLinkOut(
            goal_id=link.goal.id,
            goal_title=link.goal.title,
            goal_type=link.goal.goal_type,
            goal_status=link.goal.status,
            task_id=link.task_id,
            task_title=link.task.title if link.task is not None else None,
            note=link.note or "",
            created_at=link.created_at,
        )
        for link in links
    ]
