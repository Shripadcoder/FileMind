"""Knowledge-graph builder. The graph is computed from live rows on every
request — no graph database, nothing to go stale. Nodes: folders, files,
goals, tasks, tags, categories. Edges: contains, tagged_with, categorized_as,
linked_to (goal/file, with task context), duplicate_of (same SHA-256),
version_of (filename heuristic), has_task.

Scope controls keep responses bounded: optional focus node, BFS depth limit,
node-type filter, and hard caps. All navigation targets are real routes
(/files?open=, /goals?open=)."""

from collections import deque

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.file import File
from app.models.folder import Folder
from app.models.goals import Goal, Task
from app.models.links import GoalFile
from app.models.user import User
from app.services.versions import group_versions

NODE_LIMIT = 400
EDGE_LIMIT = 800


def _node(kind: str, rid: int, label: str, **extra) -> dict:
    node = {"id": f"{kind}:{rid}", "kind": kind, "ref_id": rid, "label": label}
    node.update(extra)
    return node


def build_graph(
    db: Session,
    user: User,
    focus_kind: str | None = None,
    focus_id: int | None = None,
    depth: int = 2,
    kinds: set[str] | None = None,
) -> dict:
    folders = list(db.execute(
        select(Folder).where(Folder.owner_id == user.id,
                             Folder.trashed_at.is_(None))).scalars())
    files = list(db.execute(
        select(File).where(File.owner_id == user.id,
                           File.trashed_at.is_(None))).scalars())
    goals = list(db.execute(select(Goal).where(Goal.owner_id == user.id)).scalars())
    tasks = list(db.execute(
        select(Task).join(Goal, Task.goal_id == Goal.id)
        .where(Goal.owner_id == user.id)).scalars())

    nodes: dict[str, dict] = {}
    edges: list[dict] = []

    def add_edge(src: str, dst: str, rel: str, **extra) -> None:
        if len(edges) >= EDGE_LIMIT:
            return
        edge = {"source": src, "target": dst, "rel": rel}
        edge.update(extra)
        edges.append(edge)

    for folder in folders:
        nodes[f"folder:{folder.id}"] = _node("folder", folder.id, folder.name)
        if folder.parent_id is not None:
            add_edge(f"folder:{folder.parent_id}", f"folder:{folder.id}", "contains")
    for file in files:
        nodes[f"file:{file.id}"] = _node(
            "file", file.id, file.original_filename,
            mime=file.mime_type, favorite=file.is_favorite,
            category=file.category.name if file.category else None)
        if file.folder_id is not None:
            add_edge(f"folder:{file.folder_id}", f"file:{file.id}", "contains")
        for tag in file.tags:
            tid = f"tag:{tag.id}"
            if tid not in nodes:
                nodes[tid] = _node("tag", tag.id, tag.name)
            add_edge(f"file:{file.id}", tid, "tagged_with")
        if file.category is not None:
            cid = f"category:{file.category.id}"
            if cid not in nodes:
                nodes[cid] = _node("category", file.category.id, file.category.name)
            add_edge(f"file:{file.id}", cid, "categorized_as")
    for goal in goals:
        nodes[f"goal:{goal.id}"] = _node(
            "goal", goal.id, goal.title, goal_type=goal.goal_type, status=goal.status)
        for task in goal.tasks:
            tid = f"task:{task.id}"
            nodes[tid] = _node("task", task.id, task.title, status=task.status,
                               goal_id=goal.id)
            add_edge(f"goal:{goal.id}", tid, "has_task")
    links = list(db.execute(
        select(GoalFile).where(GoalFile.owner_id == user.id)).scalars())
    for link in links:
        extra = {}
        if link.task_id is not None:
            extra = {"task_id": link.task_id,
                     "task_title": link.task.title if link.task else None}
        add_edge(f"goal:{link.goal_id}", f"file:{link.file_id}", "linked_to", **extra)

    sha_first: dict[str, str] = {}
    for file in files:
        fid = f"file:{file.id}"
        if file.sha256 in sha_first:
            add_edge(fid, sha_first[file.sha256], "duplicate_of")
        else:
            sha_first[file.sha256] = fid
    for group in group_versions(files):
        ids = [f"file:{f.id}" for f in group["files"]]
        for other in ids[1:]:
            add_edge(ids[0], other, "version_of", stem=group["stem"])

    if kinds:
        nodes = {nid: n for nid, n in nodes.items() if n["kind"] in kinds}
        edges = [e for e in edges if e["source"] in nodes and e["target"] in nodes]

    focus = f"{focus_kind}:{focus_id}" if focus_kind and focus_id else None
    if focus and focus in nodes:
        adjacency: dict[str, set[str]] = {}
        for edge in edges:
            adjacency.setdefault(edge["source"], set()).add(edge["target"])
            adjacency.setdefault(edge["target"], set()).add(edge["source"])
        seen = {focus}
        queue = deque([(focus, 0)])
        while queue:
            current, dist = queue.popleft()
            if dist >= max(depth, 0):
                continue
            for neighbor in adjacency.get(current, ()):
                if neighbor not in seen:
                    seen.add(neighbor)
                    queue.append((neighbor, dist + 1))
        nodes = {nid: n for nid, n in nodes.items() if nid in seen}
        edges = [e for e in edges if e["source"] in seen and e["target"] in seen]

    node_list = list(nodes.values())[:NODE_LIMIT]
    kept = {n["id"] for n in node_list}
    edge_list = [e for e in edges if e["source"] in kept and e["target"] in kept][:EDGE_LIMIT]
    return {
        "nodes": node_list,
        "edges": edge_list,
        "truncated": len(nodes) > NODE_LIMIT or len(edges) > EDGE_LIMIT,
        "focus": focus,
    }
