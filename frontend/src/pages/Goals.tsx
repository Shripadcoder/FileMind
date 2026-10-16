import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle2, Circle, Link2, Plus, Trash2 } from "lucide-react";
import {
  ApiError,
  HEALTH_LABELS,
  createGoal,
  createMilestone,
  createTask,
  deleteGoal,
  deleteMilestone,
  deleteTask,
  fmtNum,
  formatDay,
  getGoalWithLinks,
  goalActivities,
  goalTypes,
  linkFileToGoal,
  listFiles,
  listGoals,
  unlinkFileFromGoal,
  updateGoal,
  updateMilestone,
  updateTask,
} from "../lib/api";
import type {
  ActivityItem,
  FileItem,
  GoalDetailWithLinks,
  GoalItem,
  GoalTypeInfo,
  MilestoneItem,
  TaskItem,
} from "../lib/api";
import { useAuth } from "../lib/auth";
import { Badge, Button, EmptyState, Notice, PageHeader, ProgressBar, Spinner, cardCls, inputCls } from "../components/ui";

const STATUSES = ["not_started", "in_progress", "completed", "on_hold"];
const STATUS_LABELS: Record<string, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  completed: "Completed",
  on_hold: "On hold",
};
const STATUS_TONES: Record<string, "slate" | "blue" | "green" | "amber"> = {
  not_started: "slate",
  in_progress: "blue",
  completed: "green",
  on_hold: "amber",
};
const HEALTH_TONES: Record<string, "green" | "blue" | "amber" | "red" | "slate"> = {
  completed: "green",
  on_track: "green",
  behind: "amber",
  at_risk: "amber",
  overdue: "red",
  not_started: "slate",
  on_hold: "slate",
};
const PRIORITIES = ["low", "medium", "high", "urgent"];
const PRIORITY_TONES: Record<string, "slate" | "blue" | "amber" | "red"> = {
  low: "slate",
  medium: "blue",
  high: "amber",
  urgent: "red",
};

function errMsg(e: unknown): string {
  return e instanceof ApiError ? e.message : "Something went wrong";
}

export default function Goals() {
  const { user, loading } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [goals, setGoals] = useState<GoalItem[]>([]);
  const [catalog, setCatalog] = useState<GoalTypeInfo[]>([]);
  const [selected, setSelected] = useState<GoalDetailWithLinks | null>(null);
  const [history, setHistory] = useState<ActivityItem[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [goalType, setGoalType] = useState("");
  const [sort, setSort] = useState("target_date");

  const notify = useCallback((msg: string | null, isError = false) => {
    if (isError) {
      setError(msg);
      setNotice(null);
    } else {
      setNotice(msg);
      setError(null);
    }
  }, []);

  const reload = useCallback(async () => {
    const [list, types] = await Promise.all([
      listGoals({
        q: q.trim() || undefined,
        status: status || undefined,
        goal_type: goalType || undefined,
        sort,
        limit: 200,
      }),
      goalTypes(),
    ]);
    setGoals(list);
    setCatalog(types);
  }, [q, status, goalType, sort]);

  useEffect(() => {
    if (!user) return;
    setBusy(true);
    reload()
      .catch((e) => setError(errMsg(e)))
      .finally(() => setBusy(false));
  }, [user, reload]);

  async function openGoal(id: number) {
    try {
      const [detail, acts] = await Promise.all([getGoalWithLinks(id), goalActivities(id)]);
      setSelected(detail);
      setHistory(acts);
    } catch (e) {
      setError(errMsg(e));
    }
  }

  // Deep link: /goals?open=<id>.
  useEffect(() => {
    if (!user) return;
    const openId = searchParams.get("open");
    if (openId && !selected) {
      const id = Number(openId);
      if (Number.isInteger(id)) {
        openGoal(id).catch((e) => setError(errMsg(e)));
        setSearchParams({}, { replace: true });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  if (loading) return <Spinner />;
  if (!user) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Goals" sub="Sign in to track goals." />
        <EmptyState
          title="You're signed out"
          action={<Link to="/login" className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white">Sign in</Link>}
        />
      </div>
    );
  }

  const typeLabel = (t: string) => catalog.find((c) => c.type === t)?.label ?? t;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Goals"
        sub="Courses, assignments, coding, projects, reading — each with its own honest progress math."
        actions={
          <Button variant="primary" onClick={() => setShowCreate((s) => !s)} aria-expanded={showCreate}>
            <Plus size={14} /> New goal
          </Button>
        }
      />

      {notice && <Notice kind="ok">{notice}</Notice>}
      {error && <Notice kind="error">{error}</Notice>}

      {showCreate && (
        <CreateGoalForm
          catalog={catalog}
          onCreated={(g) => {
            setShowCreate(false);
            notify(`Goal “${g.title}” created.`);
            void reload().then(() => void openGoal(g.id));
          }}
          onError={(m) => notify(m, true)}
        />
      )}

      <form
        className={`${cardCls} flex flex-wrap items-center gap-2 p-3`}
        onSubmit={(e) => {
          e.preventDefault();
          void reload().catch((err) => setError(errMsg(err)));
        }}
      >
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search goals…"
          aria-label="Search goals"
          className={`${inputCls} min-w-40 flex-1`}
        />
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status" className={inputCls}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{STATUS_LABELS[s]}</option>
          ))}
        </select>
        <select value={goalType} onChange={(e) => setGoalType(e.target.value)} aria-label="Filter by goal type" className={inputCls}>
          <option value="">All types</option>
          {catalog.map((c) => (
            <option key={c.type} value={c.type}>{c.label}</option>
          ))}
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort goals" className={inputCls}>
          <option value="target_date">Deadline</option>
          <option value="progress">Progress</option>
          <option value="created_at">Recently created</option>
          <option value="title">Title</option>
        </select>
        <Button type="submit">Apply</Button>
      </form>

      {busy && goals.length === 0 ? (
        <Spinner label="Loading goals…" />
      ) : goals.length === 0 ? (
        <EmptyState
          title="No goals yet"
          hint="Create a course, assignment, coding target, project, reading goal — or anything custom."
          action={<Button variant="primary" onClick={() => setShowCreate(true)}>New goal</Button>}
        />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {goals.map((g) => (
            <li key={g.id}>
              <button
                onClick={() => void openGoal(g.id)}
                className={`block w-full p-4 text-left transition-shadow hover:shadow-pop ${cardCls} ${
                  selected?.id === g.id ? "!border-indigo-400 dark:!border-indigo-500" : ""
                }`}
                aria-expanded={selected?.id === g.id}
              >
                <span className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[15px] font-bold tracking-tight">{g.title}</span>
                  <Badge tone={HEALTH_TONES[g.health] ?? "slate"}>{HEALTH_LABELS[g.health] ?? g.health}</Badge>
                </span>
                <span className="mt-1 block text-xs text-slate-400">
                  {typeLabel(g.goal_type)}{g.category ? ` · ${g.category}` : ""} · due {formatDay(g.target_date)}
                </span>
                <span className="mt-2.5 flex items-center gap-2">
                  <ProgressBar value={g.progress.percent} />
                  <span className="fm-num w-11 shrink-0 text-right text-xs font-medium">{g.progress.percent}%</span>
                </span>
                <span className="mt-1 block truncate text-xs text-slate-400">{g.progress.detail}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {selected && (
        <GoalEditor
          goal={selected}
          history={history}
          typeLabel={typeLabel}
          onChanged={(g) => {
            setSelected(g);
            void reload().catch((e) => setError(errMsg(e)));
            goalActivities(g.id).then(setHistory).catch((e) => setError(errMsg(e)));
          }}
          onDeleted={() => {
            setSelected(null);
            notify("Goal deleted. Its activity history was preserved.");
            void reload().catch((e) => setError(errMsg(e)));
          }}
          onClose={() => setSelected(null)}
          notify={notify}
        />
      )}
    </div>
  );
}

function CreateGoalForm({
  catalog,
  onCreated,
  onError,
}: {
  catalog: GoalTypeInfo[];
  onCreated: (g: GoalDetailWithLinks) => void;
  onError: (msg: string) => void;
}) {
  const [goalType, setGoalType] = useState("course");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [priority, setPriority] = useState("medium");
  const [targetDate, setTargetDate] = useState("");
  const [targetValue, setTargetValue] = useState("100");
  const [busy, setBusy] = useState(false);

  const info = catalog.find((c) => c.type === goalType);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      onError("Title is required.");
      return;
    }
    setBusy(true);
    try {
      const goal = await createGoal({
        goal_type: goalType,
        title: title.trim(),
        description: description.trim(),
        category: category.trim(),
        priority,
        status: "in_progress",
        target_date: targetDate || null,
        target_value: Number(targetValue) > 0 ? Number(targetValue) : 100,
      });
      onCreated(goal);
    } catch (err) {
      onError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className={`${cardCls} fm-fade flex flex-col gap-3 p-4 md:p-5`}>
      <h2 className="text-[15px] font-bold tracking-tight">New goal</h2>
      <div className="grid gap-2.5 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs font-medium text-slate-500">Goal type</span>
          <select value={goalType} onChange={(e) => setGoalType(e.target.value)} className={inputCls}>
            {catalog.map((c) => (
              <option key={c.type} value={c.type}>{c.label}</option>
            ))}
          </select>
          {info && (
            <span className="text-xs text-slate-400">
              Progress from {info.default_progress_source} · unit “{info.default_unit}”
            </span>
          )}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs font-medium text-slate-500">Title</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} required className={inputCls} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-xs font-medium text-slate-500">Category</span>
          <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Machine Learning" className={inputCls} />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs font-medium text-slate-500">Priority</span>
            <select value={priority} onChange={(e) => setPriority(e.target.value)} className={inputCls}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs font-medium text-slate-500">Target date</span>
            <input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} className={inputCls} />
          </label>
        </div>
        <label className="flex flex-col gap-1 text-sm sm:col-span-2">
          <span className="text-xs font-medium text-slate-500">Description</span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={inputCls} />
        </label>
        {(goalType === "coding" || goalType === "reading" || goalType === "custom") && (
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs font-medium text-slate-500">Measurable target (e.g. 50 problems)</span>
            <input type="number" min={1} value={targetValue} onChange={(e) => setTargetValue(e.target.value)} className={inputCls} />
          </label>
        )}
      </div>
      <Button type="submit" variant="primary" disabled={busy} className="self-start">
        {busy ? "Creating…" : "Create goal"}
      </Button>
    </form>
  );
}

function GoalEditor({
  goal,
  history,
  typeLabel,
  onChanged,
  onDeleted,
  onClose,
  notify,
}: {
  goal: GoalDetailWithLinks;
  history: ActivityItem[];
  typeLabel: (t: string) => string;
  onChanged: (g: GoalDetailWithLinks) => void;
  onDeleted: () => void;
  onClose: () => void;
  notify: (msg: string | null, isError?: boolean) => void;
}) {
  const [title, setTitle] = useState(goal.title);
  const [currentValue, setCurrentValue] = useState(String(goal.current_value));
  const [notes, setNotes] = useState(goal.notes);
  const [newLinkLabel, setNewLinkLabel] = useState("");
  const [newLinkUrl, setNewLinkUrl] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setTitle(goal.title);
    setCurrentValue(String(goal.current_value));
    setNotes(goal.notes);
  }, [goal]);

  async function save(patch: Record<string, unknown>, msg = "Saved.") {
    try {
      onChanged(await updateGoal(goal.id, patch));
      notify(msg);
    } catch (e) {
      notify(errMsg(e), true);
    }
  }

  async function toggleTask(task: TaskItem) {
    try {
      await updateTask(task.id, { status: task.status === "done" ? "todo" : "done" });
      onChanged(await getGoalWithLinks(goal.id));
    } catch (e) {
      notify(errMsg(e), true);
    }
  }

  async function toggleMilestone(m: MilestoneItem) {
    try {
      await updateMilestone(m.id, { status: m.status === "completed" ? "not_started" : "completed" });
      onChanged(await getGoalWithLinks(goal.id));
    } catch (e) {
      notify(errMsg(e), true);
    }
  }

  const showManualCounter = goal.progress_source === "manual";

  return (
    <section aria-label="Goal details" className={`${cardCls} fm-fade p-4 md:p-5`}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="min-w-0 flex-1 truncate text-lg font-bold tracking-tight">{goal.title}</h2>
        <Badge tone={HEALTH_TONES[goal.health] ?? "slate"}>{HEALTH_LABELS[goal.health] ?? goal.health}</Badge>
        <Badge tone={STATUS_TONES[goal.status] ?? "slate"}>{STATUS_LABELS[goal.status]}</Badge>
        <Badge tone={PRIORITY_TONES[goal.priority] ?? "slate"}>{goal.priority}</Badge>
        <button onClick={onClose} className="rounded-md px-1.5 py-0.5 text-xs text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800" aria-label="Close goal details">✕</button>
      </div>
      <p className="mt-1 text-xs text-slate-400">
        {typeLabel(goal.goal_type)}{goal.category ? ` · ${goal.category}` : ""} · due {formatDay(goal.target_date)}
      </p>

      <div className="mt-3 flex items-center gap-2.5">
        <ProgressBar value={goal.progress.percent} />
        <span className="fm-num text-sm font-bold">{goal.progress.percent}%</span>
      </div>
      <p className="mt-1 text-xs text-slate-400">{goal.progress.detail} · source: {goal.progress.source_used}</p>

      <div className="mt-4 grid gap-5 md:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-3">
          <div>
            <h3 className="mb-1.5 text-[13px] font-bold uppercase tracking-wide text-slate-400">Details</h3>
            <div className="flex flex-col gap-2">
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-xs text-slate-400">Title</span>
                <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-xs text-slate-400">Status</span>
                  <select value={goal.status} onChange={(e) => void save({ status: e.target.value }, "Status updated.")} className={inputCls}>
                    {STATUSES.map((s) => (
                      <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-xs text-slate-400">Priority</span>
                  <select value={goal.priority} onChange={(e) => void save({ priority: e.target.value })} className={inputCls}>
                    {PRIORITIES.map((p) => (
                      <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-xs text-slate-400">Target date</span>
                  <input type="date" value={goal.target_date ?? ""} onChange={(e) => void save({ target_date: e.target.value || null })} className={inputCls} />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-xs text-slate-400">Reminder</span>
                  <input type="datetime-local" value={goal.reminder_at ? goal.reminder_at.slice(0, 16) : ""} onChange={(e) => void save({ reminder_at: e.target.value || null })} className={inputCls} />
                </label>
              </div>
              {showManualCounter && (
                <form
                  className="flex items-end gap-2 rounded-lg bg-slate-50 p-2.5 dark:bg-slate-800/60"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const v = Number(currentValue);
                    if (Number.isNaN(v) || v < 0) {
                      notify("Enter a non-negative number.", true);
                      return;
                    }
                    void save({ current_value: v }, "Progress recorded.");
                  }}
                >
                  <label className="flex flex-1 flex-col gap-1 text-sm">
                    <span className="text-xs text-slate-400">Progress ({goal.unit}, target {fmtNum(goal.target_value)})</span>
                    <input type="number" min={0} step="any" value={currentValue} onChange={(e) => setCurrentValue(e.target.value)} className={inputCls} />
                  </label>
                  <Button type="submit">Record</Button>
                </form>
              )}
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-xs text-slate-400">Notes</span>
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={inputCls} />
              </label>
              <div className="flex flex-wrap gap-1.5">
                <Button variant="primary" onClick={() => void save({ title: title.trim() || goal.title, notes })}>
                  Save title & notes
                </Button>
                {!confirmDelete ? (
                  <Button variant="danger" onClick={() => setConfirmDelete(true)}>Delete goal</Button>
                ) : (
                  <>
                    <Button variant="danger" onClick={() => deleteGoal(goal.id).then(onDeleted).catch((e) => notify(errMsg(e), true))}>
                      Confirm delete
                    </Button>
                    <Button variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button>
                  </>
                )}
              </div>
            </div>
          </div>

          <div>
            <h3 className="mb-1.5 text-[13px] font-bold uppercase tracking-wide text-slate-400">Links</h3>
            {goal.external_links.length === 0 && <p className="text-xs text-slate-400">No links yet.</p>}
            <ul className="flex flex-col gap-1">
              {goal.external_links.map((l, i) => (
                <li key={`${l.url}-${i}`} className="flex items-center gap-2 text-sm">
                  <Link2 size={13} className="shrink-0 text-slate-400" aria-hidden />
                  <a href={l.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-indigo-600 hover:underline dark:text-indigo-300">
                    {l.label}
                  </a>
                  <button
                    onClick={() => void save({ external_links: goal.external_links.filter((_, j) => j !== i) })}
                    className="text-xs text-red-600 hover:underline"
                    aria-label={`Remove link ${l.label}`}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
            <form
              className="mt-1.5 flex gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                if (!newLinkLabel.trim() || !newLinkUrl.trim()) return;
                void save(
                  { external_links: [...goal.external_links, { label: newLinkLabel.trim(), url: newLinkUrl.trim() }] },
                  "Link added.",
                );
                setNewLinkLabel("");
                setNewLinkUrl("");
              }}
            >
              <input value={newLinkLabel} onChange={(e) => setNewLinkLabel(e.target.value)} placeholder="Label" aria-label="Link label" className={`${inputCls} w-24`} />
              <input value={newLinkUrl} onChange={(e) => setNewLinkUrl(e.target.value)} placeholder="https://…" aria-label="Link URL" className={`${inputCls} min-w-0 flex-1`} />
              <Button type="submit">Add</Button>
            </form>
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <Checklist
            title={`Tasks · ${goal.tasks_done}/${goal.task_count}`}
            emptyHint={goal.progress_source === "tasks" ? "Add lectures/subtasks — goal progress derives from these." : "Break the work down into trackable tasks."}
            items={goal.tasks.map((t) => ({
              id: t.id,
              title: t.title,
              done: t.status === "done",
              meta: t.due_date ? formatDay(t.due_date) : undefined,
            }))}
            onToggle={(id) => {
              const t = goal.tasks.find((x) => x.id === id);
              if (t) void toggleTask(t);
            }}
            onDelete={(id) =>
              deleteTask(id).then(() => getGoalWithLinks(goal.id)).then(onChanged).catch((e) => notify(errMsg(e), true))
            }
            deleteLabel={(title) => `Delete task ${title}`}
            newPlaceholder="New task"
            showDue
            onAdd={(title, due) =>
              createTask(goal.id, { title, due_date: due || null })
                .then(() => getGoalWithLinks(goal.id))
                .then(onChanged)
                .catch((err) => notify(errMsg(err), true))
            }
          />

          <Checklist
            title={`Milestones · ${goal.milestones_done}/${goal.milestone_count}`}
            emptyHint="No milestones yet."
            items={goal.milestones.map((m) => ({
              id: m.id,
              title: m.title,
              done: m.status === "completed",
              meta: m.due_date ? formatDay(m.due_date) : undefined,
            }))}
            onToggle={(id) => {
              const m = goal.milestones.find((x) => x.id === id);
              if (m) void toggleMilestone(m);
            }}
            onDelete={(id) =>
              deleteMilestone(id).then(() => getGoalWithLinks(goal.id)).then(onChanged).catch((e) => notify(errMsg(e), true))
            }
            deleteLabel={(title) => `Delete milestone ${title}`}
            newPlaceholder="New milestone"
            onAdd={(title) =>
              createMilestone(goal.id, { title })
                .then(() => getGoalWithLinks(goal.id))
                .then(onChanged)
                .catch((err) => notify(errMsg(err), true))
            }
          />

          <RelatedFiles goal={goal} onChanged={onChanged} notify={notify} />

          <div>
            <h3 className="mb-1.5 text-[13px] font-bold uppercase tracking-wide text-slate-400">
              Activity history · {history.length}
            </h3>
            {history.length === 0 ? (
              <p className="text-xs text-slate-400">No activity recorded for this goal yet.</p>
            ) : (
              <ul className="fm-scroll flex max-h-48 flex-col gap-1 overflow-auto">
                {history.map((a) => (
                  <li key={a.id} className="rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs dark:bg-slate-800/60">
                    <span className="font-medium">{a.title}</span>{" "}
                    <span className="text-slate-400">· {a.activity_type} · {a.source} · {new Date(a.occurred_at).toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function Checklist({
  title,
  emptyHint,
  items,
  onToggle,
  onDelete,
  deleteLabel,
  newPlaceholder,
  showDue = false,
  onAdd,
}: {
  title: string;
  emptyHint: string;
  items: Array<{ id: number; title: string; done: boolean; meta?: string }>;
  onToggle: (id: number) => void;
  onDelete: (id: number) => void;
  deleteLabel: (title: string) => string;
  newPlaceholder: string;
  showDue?: boolean;
  onAdd: (title: string, due: string) => void;
}) {
  const [text, setText] = useState("");
  const [due, setDue] = useState("");
  return (
    <div>
      <h3 className="mb-1.5 text-[13px] font-bold uppercase tracking-wide text-slate-400">{title}</h3>
      {items.length === 0 ? (
        <p className="text-xs text-slate-400">{emptyHint}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {items.map((item) => (
            <li
              key={item.id}
              className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm transition-colors ${
                item.done
                  ? "border-transparent bg-slate-50 dark:bg-slate-800/50"
                  : "border-slate-200 hover:border-slate-300 dark:border-slate-800"
              }`}
            >
              <button
                onClick={() => onToggle(item.id)}
                aria-pressed={item.done}
                aria-label={`${item.done ? "Reopen" : "Complete"} ${item.title}`}
                className={item.done ? "text-green-600" : "text-slate-300 hover:text-indigo-500 dark:text-slate-600"}
              >
                {item.done ? <CheckCircle2 size={17} /> : <Circle size={17} />}
              </button>
              <span className={`min-w-0 flex-1 truncate ${item.done ? "text-slate-400 line-through" : "font-medium"}`}>
                {item.title}
              </span>
              {item.meta && <span className="fm-num shrink-0 text-xs text-slate-400">{item.meta}</span>}
              <button
                onClick={() => onDelete(item.id)}
                className="shrink-0 rounded p-1 text-slate-300 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950"
                aria-label={deleteLabel(item.title)}
              >
                <Trash2 size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="mt-1.5 flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          onAdd(text.trim(), due);
          setText("");
          setDue("");
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={newPlaceholder}
          aria-label={newPlaceholder}
          className={`${inputCls} min-w-0 flex-1`}
        />
        {showDue && (
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due date" className={`${inputCls} w-32`} />
        )}
        <Button type="submit">Add</Button>
      </form>
    </div>
  );
}

function RelatedFiles({
  goal,
  onChanged,
  notify,
}: {
  goal: GoalDetailWithLinks;
  onChanged: (g: GoalDetailWithLinks) => void;
  notify: (msg: string | null, isError?: boolean) => void;
}) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<FileItem[]>([]);
  const [picked, setPicked] = useState("");
  const [pickTask, setPickTask] = useState("");
  const [note, setNote] = useState("");

  async function refresh() {
    try {
      onChanged(await getGoalWithLinks(goal.id));
    } catch (e) {
      notify(errMsg(e), true);
    }
  }

  async function runSearch(e: FormEvent) {
    e.preventDefault();
    try {
      setResults(await listFiles({ q: search.trim() || undefined, limit: 20 }));
    } catch (err) {
      notify(errMsg(err), true);
    }
  }

  async function link(fileId: number, taskId: number | null, noteText: string) {
    try {
      await linkFileToGoal(goal.id, { file_id: fileId, task_id: taskId, note: noteText.trim() });
      setPicked("");
      setPickTask("");
      setNote("");
      notify("File linked.");
      await refresh();
    } catch (err) {
      notify(errMsg(err), true);
    }
  }

  return (
    <div>
      <h3 className="mb-1.5 text-[13px] font-bold uppercase tracking-wide text-slate-400">
        Related files · {goal.linked_files.length}
      </h3>
      {goal.linked_files.length === 0 ? (
        <p className="text-xs text-slate-400">Attach readings, briefs, or deliverables below.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {goal.linked_files.map((l) => (
            <li
              key={`${l.file.id}-${l.task_id ?? "goal"}`}
              className="flex items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm dark:border-slate-800"
            >
              <span className="min-w-0 flex-1 truncate font-medium">{l.file.original_filename}</span>
              {l.task_title && <Badge tone="blue">{l.task_title}</Badge>}
              {l.note && <span className="hidden max-w-32 truncate text-xs text-slate-400 xl:inline">{l.note}</span>}
              <Link to={`/files?open=${l.file.id}`} className="shrink-0 text-xs text-indigo-600 hover:underline dark:text-indigo-300">
                Open
              </Link>
              <button
                onClick={() =>
                  unlinkFileFromGoal(goal.id, l.file.id, l.task_id)
                    .then(() => refresh())
                    .catch((err) => notify(errMsg(err), true))
                }
                className="shrink-0 text-xs text-red-600 hover:underline"
                aria-label={`Unlink ${l.file.original_filename}`}
              >
                Unlink
              </button>
            </li>
          ))}
        </ul>
      )}

      {goal.suggested_files.length > 0 && (
        <div className="mt-2 rounded-lg bg-indigo-50/60 p-2.5 dark:bg-indigo-950/30">
          <p className="text-xs text-slate-500">Suggestions — same category, rule-based:</p>
          <ul className="mt-1 flex flex-col gap-1">
            {goal.suggested_files.map((f) => (
              <li key={f.id} className="flex items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{f.original_filename}</span>
                <button onClick={() => void link(f.id, null, "")} className="shrink-0 text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-300">
                  Link
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <form onSubmit={(e) => void runSearch(e)} className="mt-2 flex gap-1.5">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search files to link…"
          aria-label="Search files to link"
          className={`${inputCls} min-w-0 flex-1`}
        />
        <Button type="submit">Search</Button>
      </form>
      {results.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 rounded-lg bg-slate-50 p-2 dark:bg-slate-800/60">
          <select value={picked} onChange={(e) => setPicked(e.target.value)} aria-label="File to link" className={`${inputCls} max-w-44 flex-1`}>
            <option value="">Choose a file…</option>
            {results.map((f) => (
              <option key={f.id} value={f.id}>{f.original_filename}</option>
            ))}
          </select>
          <select value={pickTask} onChange={(e) => setPickTask(e.target.value)} aria-label="Attach to a specific task or the whole goal" className={`${inputCls} max-w-36`}>
            <option value="">Whole goal</option>
            {goal.tasks.map((t) => (
              <option key={t.id} value={t.id}>{t.title}</option>
            ))}
          </select>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note" aria-label="Link note" className={`${inputCls} w-24`} />
          <Button
            disabled={!picked}
            onClick={() => void link(Number(picked), pickTask ? Number(pickTask) : null, note)}
          >
            Link
          </Button>
        </div>
      )}
    </div>
  );
}
