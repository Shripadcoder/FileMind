import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import {
  BookOpen,
  CheckCircle2,
  Code2,
  FileUp,
  Flag,
  GraduationCap,
  NotebookPen,
  Send,
  StickyNote,
} from "lucide-react";
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
import { Button, EmptyState, Notice, PageHeader, Spinner, cardCls, inputCls } from "../components/ui";

const MANUAL_TYPES = [
  "lecture_completed",
  "problem_solved",
  "assignment_submitted",
  "document_reviewed",
  "reading_session",
  "note",
];

const TYPE_ICONS: Record<string, typeof Code2> = {
  lecture_completed: GraduationCap,
  problem_solved: Code2,
  assignment_submitted: Send,
  milestone_completed: Flag,
  task_completed: CheckCircle2,
  goal_created: Flag,
  goal_updated: Flag,
  goal_completed: CheckCircle2,
  progress_updated: CheckCircle2,
  file_uploaded: FileUp,
  document_reviewed: BookOpen,
  reading_session: BookOpen,
  code_commit: Code2,
  note: StickyNote,
};

function errMsg(e: unknown): string {
  return e instanceof ApiError ? e.message : "Something went wrong";
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
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

  const grouped = useMemo(() => {
    const map = new Map<string, ActivityItem[]>();
    for (const a of items) {
      const key = new Date(a.occurred_at).toDateString();
      if (!map.has(key)) map.set(key, []);
      map.get(key)?.push(a);
    }
    return [...map.entries()];
  }, [items]);

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

  if (loading) return <Spinner />;
  if (!user) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Activity" sub="Sign in to view your activity." />
        <EmptyState
          title="You're signed out"
          action={<Link to="/login" className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white">Sign in</Link>}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <PageHeader title="Activity" sub="Completions log themselves — record the rest here." />

      {notice && <Notice kind="ok">{notice}</Notice>}
      {error && <Notice kind="error">{error}</Notice>}

      <form onSubmit={(e) => void submit(e)} className={`${cardCls} fm-fade flex flex-col gap-2.5 p-4 md:p-5`}>
        <h2 className="flex items-center gap-1.5 text-[15px] font-bold tracking-tight">
          <NotebookPen size={16} className="text-indigo-500" aria-hidden /> Log activity
        </h2>
        <div className="grid gap-2.5 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs text-slate-400">Type</span>
            <select value={logType} onChange={(e) => setLogType(e.target.value)} className={inputCls}>
              {MANUAL_TYPES.map((t) => (
                <option key={t} value={t}>{ACTIVITY_TYPE_LABELS[t]}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs text-slate-400">Title</span>
            <input value={logTitle} onChange={(e) => setLogTitle(e.target.value)} placeholder="e.g. Solved 5 graph problems" required className={inputCls} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs text-slate-400">Related goal</span>
            <select value={logGoal} onChange={(e) => setLogGoal(e.target.value)} className={inputCls}>
              <option value="">None</option>
              {goals.map((g) => (
                <option key={g.id} value={g.id}>{g.title}</option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs text-slate-400">Amount</span>
              <input type="number" min={0} step="any" value={logValue} onChange={(e) => setLogValue(e.target.value)} placeholder="e.g. 5" className={inputCls} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs text-slate-400">Date</span>
              <input type="date" value={logDate} onChange={(e) => setLogDate(e.target.value)} className={inputCls} />
            </label>
          </div>
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="text-xs text-slate-400">Description</span>
            <input value={logDesc} onChange={(e) => setLogDesc(e.target.value)} className={inputCls} />
          </label>
        </div>
        <Button type="submit" variant="primary" className="self-start">Log activity</Button>
      </form>

      <form
        className={`${cardCls} flex flex-wrap items-center gap-2 p-3`}
        onSubmit={(e) => {
          e.preventDefault();
          void reload().catch((err) => setError(errMsg(err)));
        }}
      >
        <select value={filterType} onChange={(e) => setFilterType(e.target.value)} aria-label="Filter by activity type" className={`${inputCls} flex-1`}>
          <option value="">All types</option>
          {Object.entries(ACTIVITY_TYPE_LABELS).map(([t, label]) => (
            <option key={t} value={t}>{label}</option>
          ))}
        </select>
        <select value={filterGoal} onChange={(e) => setFilterGoal(e.target.value)} aria-label="Filter by goal" className={`${inputCls} flex-1`}>
          <option value="">All goals</option>
          {goals.map((g) => (
            <option key={g.id} value={g.id}>{g.title}</option>
          ))}
        </select>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" className={inputCls} />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" className={inputCls} />
        <Button type="submit">Apply</Button>
        {(filterType || filterGoal || from || to) && (
          <button
            type="button"
            onClick={() => {
              setFilterType("");
              setFilterGoal("");
              setFrom("");
              setTo("");
            }}
            className="text-sm text-slate-500 underline"
          >
            Clear
          </button>
        )}
      </form>

      {items.length === 0 ? (
        <EmptyState title="No activity matches" hint="Log your first entry above — completions of tasks, milestones, and goals appear here automatically." />
      ) : (
        <div className="flex flex-col gap-5">
          {grouped.map(([day, acts]) => (
            <section key={day} aria-label={dayLabel(acts[0].occurred_at)}>
              <p className="mb-1.5 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-slate-400">
                <span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" aria-hidden />
                {dayLabel(acts[0].occurred_at)}
                <span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" aria-hidden />
              </p>
              <ol className="relative flex flex-col gap-1.5 border-l-2 border-slate-200 pl-4 dark:border-slate-800">
                {acts.map((a) => {
                  const Icon = TYPE_ICONS[a.activity_type] ?? StickyNote;
                  return (
                    <li key={a.id} className={`${cardCls} flex items-start gap-2.5 p-3`}>
                      <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${a.source === "auto" ? "bg-indigo-100 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-300" : "bg-slate-100 text-slate-500 dark:bg-slate-800"}`} aria-hidden>
                        <Icon size={15} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold leading-snug">{a.title}</p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-slate-400">
                          <span>{ACTIVITY_TYPE_LABELS[a.activity_type] ?? a.activity_type}</span>
                          {a.goal_title && <span>· {a.goal_title}</span>}
                          {a.value > 0 && <span className="fm-num">· +{fmtNum(a.value)}</span>}
                          <span className="fm-num">· {formatDate(a.occurred_at)}</span>
                        </p>
                        {a.description && <p className="mt-1 text-[13px] text-slate-500">{a.description}</p>}
                      </div>
                      <button
                        onClick={() => deleteActivity(a.id).then(() => reload()).catch((err) => setError(errMsg(err)))}
                        className="shrink-0 rounded p-1 text-xs text-slate-300 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950"
                        aria-label={`Delete activity ${a.title}`}
                      >
                        Delete
                      </button>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
