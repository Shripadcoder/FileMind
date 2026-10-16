"""Goal progress + health engine.

Each goal type derives progress differently instead of forcing one generic
percentage:
- tasks source (course, assignment): done tasks / total tasks
- milestones source (project): completed milestones / total
- manual source (coding, reading, custom): current_value / target_value

When a derived source has no items yet, the manual values are the fallback so
a goal never shows a misleading 0% that contradicts recorded work. The
response always names the source actually used.
"""

from datetime import date

from app.models.goals import Milestone, Task
from app.schemas.goals import ProgressOut


def compute_progress(
    goal_type: str,
    progress_source: str,
    current_value: float,
    target_value: float,
    unit: str,
    tasks: list[Task],
    milestones: list[Milestone],
) -> ProgressOut:
    if progress_source == "tasks" and tasks:
        done = sum(1 for t in tasks if t.status == "done")
        return ProgressOut(
            percent=round(done / len(tasks) * 100, 1),
            source_used="tasks",
            current=float(done),
            target=float(len(tasks)),
            unit="tasks",
            detail=f"{done} of {len(tasks)} tasks done",
        )
    if progress_source == "milestones" and milestones:
        done = sum(1 for m in milestones if m.status == "completed")
        return ProgressOut(
            percent=round(done / len(milestones) * 100, 1),
            source_used="milestones",
            current=float(done),
            target=float(len(milestones)),
            unit="milestones",
            detail=f"{done} of {len(milestones)} milestones completed",
        )
    target = target_value if target_value > 0 else 1.0
    percent = round(max(0.0, min(current_value / target, 1.0)) * 100, 1)
    fallback = f" (no {progress_source} yet — using manual values)" if progress_source != "manual" else ""
    return ProgressOut(
        percent=percent,
        source_used="manual",
        current=float(current_value),
        target=float(target_value),
        unit=unit or DEFAULT_UNIT_FALLBACK,
        detail=f"{_fmt(current_value)} of {_fmt(target_value)} {unit}{fallback}",
    )


DEFAULT_UNIT_FALLBACK = "%"


def _fmt(value: float) -> str:
    return str(int(value)) if float(value).is_integer() else str(round(value, 1))


def goal_health(
    status: str,
    percent: float,
    start: date | None,
    target: date | None,
    today: date,
) -> str:
    """Pace-based health. 'behind'/'at_risk' compare recorded progress against
    elapsed schedule — they describe risk, while percent stays factual."""
    if status == "completed":
        return "completed"
    if status == "on_hold":
        return "on_hold"
    if target is not None and target < today:
        return "overdue"
    if status == "not_started":
        return "not_started" if percent <= 0 else "on_track"
    if target is None:
        return "on_track"
    total_days = max((target - (start or today)).days, 1)
    elapsed_days = max((today - (start or today)).days, 0)
    expected = min(elapsed_days / total_days, 1.0) * 100
    days_left = (target - today).days
    if (days_left <= 7 and percent < 70) or percent < expected * 0.6:
        return "at_risk"
    if percent < expected:
        return "behind"
    return "on_track"
