import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  ACTIVITY_TYPE_LABELS,
  ApiError,
  createActivity,
  deleteActivity,
  fmtNum,
  formatDate,
  listActivities,
  listGoals,
} from "../lib/api";
import type { ActivityItem, GoalItem } from "../lib/api";
import { useAuth } from "../lib/auth";

const MANUAL_TYPES = [
  "lecture_completed",
  "problem_solved",
  "assignment_submitted",
  "document_reviewed",
  "reading_session",
  "note",
];

function errMsg(e: unknown): string {
  return e instanceof ApiError ? e.message : "Something went wrong";
}

export default function Activity() {
  const { user, loading } = useAuth();
  const [items, setItems] = useState<ActivityItem[]>([]);
  const [goals, setGoals] = useState<GoalItem[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [filterType, setFilterType] = useState("");
  const [filterGoal, setFilterGoal] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const [logType, setLogType] = useState("problem_solved");
  const [logTitle, setLogTitle] = useState("");
  const [logDesc, setLogDesc] = useState("");
  const [logGoal, setLogGoal] = useState("");
  const [logValue, setLogValue] = useState("");
  const [logDate, setLogDate] = useState("");

  const reload = useCallback(async () => {
    const [acts, gs] = await Promise.all([
      listActivities({
        activity_type: filterType || undefined,
        goal_id: filterGoal ? Number(filterGoal) : undefined,
        occurred_from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
        occurred_to: to ? new Date(`${to}T23:59:59`).toISOString() : undefined,
        limit: 200,
      }),
      listGoals({ limit: 200 }),
    ]);
    setItems(acts);
    setGoals(gs);
  }, [filterType, filterGoal, from, to]);

  useEffect(() => {
    if (!user) return;
    reload().catch((e) => setError(errMsg(e)));
  }, [user, reload]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!logTitle.trim()) {
      setError("Title is required.");
      return;
    }
    try {
      await createActivity({
        activity_type: logType,
        title: logTitle.trim(),
        description: logDesc.trim(),
        goal_id: logGoal ? Number(logGoal) : null,
        value: logValue ? Number(logValue) : 0,
        occurred_at: logDate ? new Date(`${logDate}T12:00:00`).toISOString() : null,
      });
      setLogTitle("");
      setLogDesc("");
      setLogValue("");
      setLogDate("");
      setNotice("Activity logged.");
      setError(null);
      await reload();
    } catch (err) {
      setError(errMsg(err));
      setNotice(null);
    }
  }

  if (loading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (!user) {
    return (
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">Activity</h1>
        <p className="text-sm text-slate-500">
          Sign in to view your activity.{" "}
          <Link to="/login" className="underline">
            Go to sign in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">Activity</h1>

      {notice && (
        <div role="status" className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-900">
          {notice}
        </div>
      )}
      {error && (
        <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <form
        onSubmit={(e) => void submit(e)}
        className="flex flex-col gap-2 rounded-xl border border-slate-200 p-4 dark:border-slate-800"
      >
        <h2 className="font-semibold">Log activity</h2>
        <p className="text-xs text-slate-500">
          Record real work — completed lectures, solved problems, reading sessions. Completions of
          tasks, milestones, goals, and file uploads are logged automatically.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            Type
            <select
              value={logType}
              onChange={(e) => setLogType(e.target.value)}
              className="rounded-lg border border-slate-200 bg-transparent px-2 py-1.5 dark:border-slate-700"
            >
              {MANUAL_TYPES.map((t) => (
                <option key={t} value={t}>
                  {ACTIVITY_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Title
            <input
              value={logTitle}
              onChange={(e) => setLogTitle(e.target.value)}
              placeholder="e.g. Solved 5 graph problems"
              required
              className="rounded-lg border border-slate-200 bg-transparent px-2 py-1.5 dark:border-slate-700"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Related goal (optional)
            <select
              value={logGoal}
              onChange={(e) => setLogGoal(e.target.value)}
              className="rounded-lg border border-slate-200 bg-transparent px-2 py-1.5 dark:border-slate-700"
            >
              <option value="">None</option>
              {goals.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-sm">
              Amount (optional)
              <input
                type="number"
                min={0}
                step="any"
                value={logValue}
                onChange={(e) => setLogValue(e.target.value)}
                placeholder="e.g. 5"
                className="rounded-lg border border-slate-200 bg-transparent px-2 py-1.5 dark:border-slate-700"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Date (default today)
              <input
                type="date"
                value={logDate}
                onChange={(e) => setLogDate(e.target.value)}
                className="rounded-lg border border-slate-200 bg-transparent px-2 py-1.5 dark:border-slate-700"
              />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            Description
            <input
              value={logDesc}
              onChange={(e) => setLogDesc(e.target.value)}
              className="rounded-lg border border-slate-200 bg-transparent px-2 py-1.5 dark:border-slate-700"
            />
          </label>
        </div>
        <button
          type="submit"
          className="self-start rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-slate-100 dark:text-slate-900"
        >
          Log activity
        </button>
      </form>

      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void reload().catch((err) => setError(errMsg(err)));
        }}
      >
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          aria-label="Filter by activity type"
          className="rounded-lg border border-slate-200 bg-transparent px-2 py-1.5 text-sm dark:border-slate-700"
        >
          <option value="">All types</option>
          {Object.entries(ACTIVITY_TYPE_LABELS).map(([t, label]) => (
            <option key={t} value={t}>
              {label}
            </option>
          ))}
        </select>
        <select
          value={filterGoal}
          onChange={(e) => setFilterGoal(e.target.value)}
          aria-label="Filter by goal"
          className="rounded-lg border border-slate-200 bg-transparent px-2 py-1.5 text-sm dark:border-slate-700"
        >
          <option value="">All goals</option>
          {goals.map((g) => (
            <option key={g.id} value={g.id}>
              {g.title}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          aria-label="From date"
          className="rounded-lg border border-slate-200 bg-transparent px-2 py-1.5 text-sm dark:border-slate-700"
        />
        <input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          aria-label="To date"
          className="rounded-lg border border-slate-200 bg-transparent px-2 py-1.5 text-sm dark:border-slate-700"
        />
        <button
          type="submit"
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm dark:border-slate-700"
        >
          Apply
        </button>
        {(filterType || filterGoal || from || to) && (
          <button
            type="button"
            onClick={() => {
              setFilterType("");
              setFilterGoal("");
              setFrom("");
              setTo("");
            }}
            className="text-sm underline"
          >
            Clear
          </button>
        )}
      </form>

      {items.length === 0 ? (
        <p className="text-sm text-slate-500">No activity matches. Log your first entry above.</p>
      ) : (
        <ol className="flex flex-col gap-1">
          {items.map((a) => (
            <li
              key={a.id}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm dark:border-slate-800"
            >
              <span
                className={`rounded px-1.5 text-xs ${
                  a.source === "auto" ? "bg-blue-100 text-blue-800" : "bg-slate-100 text-slate-600"
                }`}
              >
                {a.source}
              </span>
              <span className="font-medium">{a.title}</span>
              <span className="text-xs text-slate-500">
                {ACTIVITY_TYPE_LABELS[a.activity_type] ?? a.activity_type}
              </span>
              {a.goal_title && <span className="text-xs text-slate-500">· {a.goal_title}</span>}
              {a.value > 0 && <span className="text-xs text-slate-500">· +{fmtNum(a.value)}</span>}
              <span className="ml-auto text-xs text-slate-500">{formatDate(a.occurred_at)}</span>
              <button
                onClick={() =>
                  deleteActivity(a.id)
                    .then(() => reload())
                    .catch((err) => setError(errMsg(err)))
                }
                className="text-xs text-red-600 underline"
                aria-label={`Delete activity ${a.title}`}
              >
                Delete
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
