"""Productivity assistant: deterministic intents over the user's real records.

Every reply separates FACTS (rows from the database, quoted with numbers)
from SUGGESTIONS (heuristic advice, explicitly labeled as such). The engine
never invents tasks, progress values, or completions — an empty database
produces an honest empty answer, not encouragement theater.

Optional external-LLM polish only rewords the templated text; facts and
suggestions lists pass through untouched."""

import re
from datetime import date


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", text.lower()).strip()


def _as_date(value) -> date | None:
    if value is None:
        return None
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value))
    except ValueError:
        return None


def detect_intent(question: str) -> str:
    q = _norm(question)
    if any(k in q for k in ("priorit", "most important", "what first", "focus on")):
        return "prioritize"
    if "today" in q or "work on" in q or "should i do" in q:
        return "today"
    if "on track" in q or "on-track" in q or "behind" in q or "deadline" in q:
        return "on_track"
    if "least progress" in q or "stuck" in q or "neglect" in q:
        return "least_progress"
    if "summar" in q and ("week" in q or "productivity" in q or "progress" in q):
        return "week_summary"
    if "summar" in q:
        return "week_summary"
    if any(k in q for k in ("file", "document", "project", "associated", "related")):
        return "files_for"
    if "overdue" in q or "late" in q or "missed" in q:
        return "overdue"
    if "upcoming" in q or "coming up" in q or "next" in q or "due" in q:
        return "upcoming"
    return "help"


def _goal_by_name(goals: list[dict], question: str) -> dict | None:
    q = _norm(question)
    words = {w for w in re.findall(r"[a-z]{4,}", q)}
    best, best_score = None, 0
    for goal in goals:
        hay = _norm(f"{goal['title']} {goal.get('category', '')} {goal['goal_type']}")
        score = len(words & set(re.findall(r"[a-z]{4,}", hay)))
        if score > best_score:
            best, best_score = goal, score
    return best if best_score > 0 else None


def answer(question: str, ctx: dict) -> dict:
    """ctx keys: goals (list of dicts with progress/health/target_date/...),
    today (brief tasks), overdue_tasks, overdue_goals, upcoming_tasks,
    upcoming_goals, week (activity counts), coding (stats), links
    (goal_id -> list of {filename, task_title}), today_str."""
    intent = detect_intent(question)
    handler = {
        "today": _today, "on_track": _on_track, "least_progress": _least_progress,
        "files_for": _files_for, "week_summary": _week_summary,
        "prioritize": _prioritize, "overdue": _overdue, "upcoming": _upcoming,
    }.get(intent, _help)
    result = handler(question, ctx)
    result["intent"] = intent
    result["source"] = "rules+records"
    return result


def _fmt_goal(g: dict) -> str:
    due = f", due {g['target_date']}" if g.get("target_date") else ", no deadline"
    return f"{g['title']} ({g['goal_type']}, {g['progress']['percent']}%, {g['health']}{due})"


def _today(_q: str, ctx: dict) -> dict:
    facts = []
    for t in ctx["today"]:
        facts.append(f"TASK DUE: {t['title']} (goal: {t['goal_title']})")
    for g in ctx["overdue_goals"]:
        facts.append(f"OVERDUE GOAL: {_fmt_goal(g)}")
    suggestions = []
    if ctx["overdue_tasks"] or ctx["overdue_goals"]:
        suggestions.append("Clear overdue items first — they compound fastest.")
    if not facts:
        return {"answer": "Nothing is due today and nothing is overdue. Consider pulling the "
                          "nearest upcoming task forward, or logging progress on an active goal.",
                "facts": [], "suggestions": ["Pick the active goal closest to its deadline."]}
    lines = ["Here's what needs attention today:"] + [f"- {f}" for f in facts]
    if suggestions:
        lines += ["", "Suggestion: " + suggestions[0]]
    return {"answer": "\n".join(lines), "facts": facts, "suggestions": suggestions}


def _on_track(question: str, ctx: dict) -> dict:
    goals = [g for g in ctx["goals"] if g["status"] != "completed"]
    target = _goal_by_name(goals, question)
    if target:
        facts = [f"{target['title']}: {target['progress']['percent']}% "
                 f"({target['progress']['detail']}), health: {target['health']}"]
        verdict = (f"{target['title']} is {target['health'].replace('_', ' ')} at "
                   f"{target['progress']['percent']}% ({target['progress']['detail']}).")
        suggestions = []
        if target["health"] in ("behind", "at_risk", "overdue"):
            suggestions.append(f"Protect time for {target['title']} this week.")
        return {"answer": verdict, "facts": facts, "suggestions": suggestions}
    counts: dict[str, int] = {}
    for g in goals:
        counts[g["health"]] = counts.get(g["health"], 0) + 1
    facts = [f"{len(goals)} active goals: " +
             ", ".join(f"{c} {h.replace('_', ' ')}" for h, c in sorted(counts.items()))]
    if not goals:
        return {"answer": "You have no active goals, so there is nothing to be on track for.",
                "facts": [], "suggestions": ["Create a goal to start tracking."]}
    return {"answer": "Overall: " + facts[0] + ". Name a goal for a per-goal verdict.",
            "facts": facts, "suggestions": []}


def _least_progress(_q: str, ctx: dict) -> dict:
    active = [g for g in ctx["goals"] if g["status"] in ("not_started", "in_progress")]
    if not active:
        return {"answer": "No active goals to compare.", "facts": [], "suggestions": []}
    ranked = sorted(active, key=lambda g: g["progress"]["percent"])
    bottom = ranked[:3]
    facts = [f"LOWEST PROGRESS: {_fmt_goal(g)}" for g in bottom]
    lines = ["Least progress first:"] + [f"- {f}" for f in facts]
    suggestions = [f"Give {bottom[0]['title']} one small session — restarting beats replanning."]
    return {"answer": "\n".join(lines + ["", "Suggestion: " + suggestions[0]]),
            "facts": facts, "suggestions": suggestions}


def _files_for(question: str, ctx: dict) -> dict:
    goals = [g for g in ctx["goals"]]
    target = _goal_by_name(goals, question)
    if target is None:
        names = ", ".join(g["title"] for g in goals[:10]) or "none yet"
        return {"answer": f"I couldn't match a goal in your question. Your goals: {names}.",
                "facts": [], "suggestions": ["Name one of these goals and ask again."]}
    files = ctx["links"].get(target["id"], [])
    facts = [f"GOAL: {target['title']} ({target['goal_type']})"]
    if not files:
        return {"answer": f"No files are linked to {target['title']} yet. "
                          f"Suggested next step is in the goal's Related files section.",
                "facts": facts,
                "suggestions": [f"Link the key documents to {target['title']} first."]}
    facts += [f"LINKED FILE: {f['filename']}" + (f" (task: {f['task_title']})" if f.get("task_title") else "")
              for f in files]
    lines = [f"Files linked to {target['title']}:"] + [f"- {f}" for f in facts[1:]]
    return {"answer": "\n".join(lines), "facts": facts, "suggestions": []}


def _week_summary(_q: str, ctx: dict) -> dict:
    week = ctx["week"]
    total = sum(w["count"] for w in week)
    facts = [f"{total} activity events in the last 7 days"]
    for t in ctx.get("activity_by_type", [])[:6]:
        facts.append(f"{t['activity_type']}: {t['count']}" +
                     (f" (total {t['total_value']:g})" if t["total_value"] else ""))
    facts.append(f"Coding problems this week: {ctx['coding']['problems_this_week']:g}")
    facts.append(f"Goals completed: {ctx['completed_count']}, active: {ctx['active_count']}")
    suggestions = []
    if total == 0:
        suggestions.append("No activity recorded — log sessions as you work to make this useful.")
    return {"answer": "Your week in facts:\n" + "\n".join(f"- {f}" for f in facts),
            "facts": facts, "suggestions": suggestions}


def _prioritize(_q: str, ctx: dict) -> dict:
    today = date.fromisoformat(ctx["today_str"])
    ranked: list[tuple[int, str, str]] = []  # (urgency, fact, reason)
    seen: set[int] = set()
    for t in ctx["today"]:
        # Due today (or already overdue and still open): highest urgency.
        due = _as_date(t.get("due_date"))
        reason = "due today" if due == today else (
            f"overdue by {(today - due).days} day(s)" if due and due < today else "due now")
        ranked.append((0, f"TASK: {t['title']} (goal: {t['goal_title']})", reason))
        seen.add(t["id"])
    for t in ctx["overdue_tasks"]:
        if t["id"] in seen:
            continue
        due = _as_date(t.get("due_date"))
        days = (today - due).days if due else 99
        ranked.append((0, f"TASK: {t['title']} (goal: {t['goal_title']})",
                       f"overdue by {days} day(s)"))
    for g in ctx["overdue_goals"]:
        ranked.append((0, f"GOAL: {g['title']}", "past its target date"))
    for t in ctx["upcoming_tasks"]:
        if t["id"] in seen:
            continue
        due = _as_date(t.get("due_date"))
        days = (due - today).days if due else 99
        ranked.append((1, f"TASK: {t['title']} (goal: {t['goal_title']})", f"due in {days} day(s)"))
    for g in ctx["goals"]:
        if g["status"] in ("not_started", "in_progress") and g["health"] in ("at_risk", "behind"):
            ranked.append((2, f"GOAL: {g['title']} ({g['progress']['percent']}%)",
                           f"health: {g['health'].replace('_', ' ')}"))
    ranked.sort(key=lambda r: r[0])
    top = ranked[:5]
    if not top:
        return {"answer": "Nothing urgent in your records. Work on whatever moves an active goal.",
                "facts": [], "suggestions": []}
    facts = [f"{fact} — {reason}" for _, fact, reason in top]
    lines = ["Suggested order (reasons are factual):"] + [f"{i + 1}. {f}" for i, f in enumerate(facts)]
    return {"answer": "\n".join(lines), "facts": facts,
            "suggestions": ["This ordering is urgency-first; your own energy and judgment come first."]}


def _overdue(_q: str, ctx: dict) -> dict:
    facts = ([f"OVERDUE TASK: {t['title']} (goal: {t['goal_title']})" for t in ctx["overdue_tasks"]] +
             [f"OVERDUE GOAL: {_fmt_goal(g)}" for g in ctx["overdue_goals"]])
    if not facts:
        return {"answer": "Nothing is overdue.", "facts": [], "suggestions": []}
    return {"answer": "Overdue items:\n" + "\n".join(f"- {f}" for f in facts),
            "facts": facts, "suggestions": ["Reschedule or shrink the oldest item first."]}


def _upcoming(_q: str, ctx: dict) -> dict:
    facts = ([f"DUE: {t['title']} on {t['due_date']} (goal: {t['goal_title']})"
              for t in ctx["upcoming_tasks"]] +
             [f"GOAL DUE: {g['title']} on {g['target_date']}" for g in ctx["upcoming_goals"]])
    if not facts:
        return {"answer": "Nothing due in the next 7 days.", "facts": [], "suggestions": []}
    return {"answer": "Coming up:\n" + "\n".join(f"- {f}" for f in facts),
            "facts": facts, "suggestions": []}


def _help(_q: str, _ctx: dict) -> dict:
    return {
        "answer": ("I answer from your actual goals, tasks, files, and activity. Try:\n"
                   "- What should I work on today?\n"
                   "- Am I on track to finish <goal>?\n"
                   "- Which goals have made the least progress?\n"
                   "- Show me the files for <project>.\n"
                   "- Summarize my productivity this week.\n"
                   "- Which tasks should I prioritize?"),
        "facts": [], "suggestions": [],
    }
