from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.api.goals import get_owned_goal, serialize_goal_detail
from app.core.time import utcnow
from app.db.session import get_db
from app.models.goals import Goal
from app.models.user import User
from app.schemas.advanced import (
    GitHubImportIn,
    GitHubLogActivityIn,
    GitHubRepoOut,
    IntegrationsStatusOut,
    ProviderStatus,
)
from app.schemas.activities import ActivityOut
from app.schemas.goals import GoalCreate, GoalDetail
from app.services.activity_log import log_activity
from app.services.integrations import github
from app.services.integrations.base import ProviderError

from datetime import date

router = APIRouter(prefix="/integrations", tags=["integrations"])


@router.get("/status", response_model=IntegrationsStatusOut)
def integrations_status(current: User = Depends(get_current_user)):
    return IntegrationsStatusOut(providers=[
        ProviderStatus(
            key="github", label="GitHub (public repositories)", available=True,
            note="No token needed. Import a repo as a project goal or log its latest commit."),
        ProviderStatus(
            key="leetcode", label="LeetCode", available=False,
            note="No public API. Log solved problems manually (Activity → Problem solved) "
                 "or via the coding-goal progress counter."),
        ProviderStatus(
            key="courses", label="Learning platforms (Coursera, Udemy, edX)", available=False,
            note="No standard public progress API. Track lectures as course-goal tasks and "
                 "log completions manually."),
    ])


@router.get("/github/repos", response_model=list[GitHubRepoOut])
def github_repos(
    username: str = Query(min_length=1, max_length=100),
    current: User = Depends(get_current_user),
):
    try:
        repos = github.list_repos(username)
    except ProviderError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc))
    return [GitHubRepoOut(**repo.__dict__) for repo in repos]


@router.post("/github/import", response_model=GoalDetail)
def github_import(
    body: GitHubImportIn,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    try:
        repos = github.list_repos(body.username)
    except ProviderError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc))
    match = next((r for r in repos if r.name.lower() == body.repo.strip().lower()), None)
    if match is None:
        raise HTTPException(status_code=404,
                            detail=f"Repository '{body.repo}' not found for user '{body.username}'")
    fields = github.repo_to_goal_fields(match, body.category)
    create = GoalCreate(**fields)
    goal = Goal(
        owner_id=current.id, goal_type=create.goal_type, title=create.title,
        description=create.description, category=create.category, priority=create.priority,
        status=create.status, progress_source=create.progress_source or "milestones",
        unit="milestones",
        external_links=[link.model_dump() for link in create.external_links],
    )
    db.add(goal)
    db.flush()
    log_activity(db, owner_id=current.id, activity_type="goal_created",
                 title=f"Imported GitHub repo: {goal.title}", goal_id=goal.id,
                 details={"goal_type": "project", "provider": "github",
                          "repo": f"{match.owner}/{match.name}"})
    db.commit()
    db.refresh(goal)
    return serialize_goal_detail(db, current, goal, date.today())


@router.post("/github/log-activity", response_model=ActivityOut)
def github_log_activity(
    body: GitHubLogActivityIn,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_user),
):
    from app.api.activities import activity_to_out

    goal = None
    if body.goal_id is not None:
        goal = get_owned_goal(db, current, body.goal_id)
    try:
        commit = github.latest_commit(body.username.strip(), body.repo.strip())
    except ProviderError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc))
    activity = log_activity(
        db, owner_id=current.id, activity_type="code_commit",
        title=f"Commit {commit.sha}: {commit.message}",
        goal_id=goal.id if goal else None,
        details={"provider": "github", "repo": f"{body.username}/{body.repo}",
                 "sha": commit.sha, "url": commit.html_url,
                 "author": commit.author, "date": commit.date},
        source="manual",
    )
    db.commit()
    db.refresh(activity)
    return activity_to_out(activity, goal_title=goal.title if goal else None)
