"""GitHub provider (public API, no token required).

Covers the realistic unauthenticated flows: browse a user's public repos,
import one as a FileMind project goal, and log its latest commit as activity.
Private repos and higher rate limits need a token — deliberately out of scope
for the initial implementation (see module docstring for the posture)."""

import httpx

from app.services.integrations.base import CommitInfo, ProviderError, RepoInfo

API = "https://api.github.com"
TIMEOUT = 20


def _get(path: str) -> object:
    try:
        resp = httpx.get(
            f"{API}{path}",
            headers={"Accept": "application/vnd.github+json",
                     "User-Agent": "FileMind"},
            timeout=TIMEOUT,
        )
    except httpx.HTTPError as exc:
        raise ProviderError(f"GitHub is unreachable: {type(exc).__name__}")
    if resp.status_code == 404:
        raise ProviderError("Not found on GitHub", status_code=404)
    if resp.status_code in (403, 429):
        raise ProviderError("GitHub rate limit reached — try again later",
                            status_code=429)
    if resp.status_code != 200:
        raise ProviderError(f"GitHub error {resp.status_code}", status_code=502)
    return resp.json()


def list_repos(username: str) -> list[RepoInfo]:
    name = username.strip().lstrip("@")
    if not name or "/" in name or " " in name:
        raise ProviderError("Invalid GitHub username", status_code=422)
    data = _get(f"/users/{name}/repos?per_page=100&sort=updated")
    if not isinstance(data, list):
        raise ProviderError("Unexpected GitHub response", status_code=502)
    repos = []
    for item in data:
        if not isinstance(item, dict):
            continue
        owner = ((item.get("owner") or {}).get("login")) or name
        repos.append(RepoInfo(
            owner=str(owner), name=str(item.get("name", "")),
            description=str(item.get("description") or ""),
            html_url=str(item.get("html_url") or ""),
            language=item.get("language"),
            stars=int(item.get("stargazers_count") or 0),
            updated_at=item.get("updated_at")))
    return repos


def latest_commit(owner: str, repo: str) -> CommitInfo:
    data = _get(f"/repos/{owner}/{repo}/commits?per_page=1")
    if not isinstance(data, list) or not data:
        raise ProviderError("No commits found for this repository", status_code=404)
    item = data[0]
    commit = item.get("commit", {}) if isinstance(item, dict) else {}
    author = commit.get("author", {}) or {}
    return CommitInfo(
        sha=str(item.get("sha", ""))[:7],
        message=str(commit.get("message", "")).split("\n")[0][:200],
        author=(author.get("name")),
        date=author.get("date"),
        html_url=str(item.get("html_url", "")),
    )


def repo_to_goal_fields(repo: RepoInfo, category: str = "") -> dict:
    description = repo.description or f"GitHub repository {repo.owner}/{repo.name}."
    if repo.language:
        description += f" Primary language: {repo.language}."
    return {
        "goal_type": "project",
        "title": repo.name,
        "description": description[:2000],
        "category": category.strip()[:120],
        "priority": "medium",
        "status": "in_progress",
        "progress_source": "milestones",
        "external_links": [{"label": "GitHub repository", "url": repo.html_url}],
    }
