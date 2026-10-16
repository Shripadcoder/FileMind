import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Circle, Plus, Trash2 } from "lucide-react";
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
  getGoal,
  goalActivities,
  goalTypes,
  listGoals,
  updateGoal,
  updateMilestone,
  updateTask,
} from "../lib/api";
import type {
  ActivityItem,
  GoalDetail,
  GoalItem,
  GoalTypeInfo,
  MilestoneItem,
  TaskItem,
} from "../lib/api";
import { useAuth } from "../lib/auth";

const STATUSES = ["not_started", "in_progress", "completed", "on_hold"];
const STATUS_LABELS: Record<string, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  completed: "Completed",
  on_hold: "On hold",
};

function errMsg(e: unknown): string {
  return e instanceof ApiError ? e.message : "Something went wrong";
}

function HealthBadge({ health }: { health: string }) {
  const colors: Record<string, string> = {
    completed: "bg-green-100 text-green-800",
    on_track: "bg-blue-100 text-blue-800",
    behind: "bg-orange-100 text-orange-800",
    at_risk: "bg-amber-100 text-amber-800",
    overdue: "bg-red-100 text-red-800",
    not_started: "bg-slate-100 text-slate-600",
    on_hold: "bg-slate-200 text-slate-600",
  };
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${colors[health] ?? "bg-slate-100"}`}>
      {HEALTH_LABELS[health] ?? health}
    </span>
  );
}

function ProgressBar({ percent }: { percent: number }) {
  return (
    <div
      className="h-2 w-full overflow-hidden rounded bg-slate-200 dark:bg-slate-700"
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="h-full rounded bg-slate-900 dark:bg-slate-100" style={{ width: `${percent}%` }} />
    </div>
  );
}

export default function Goals() {
  const { user, loading } = useAuth();
  const [goals, setGoals] = useState<GoalItem[]>([]);
  const [catalog, setCatalog] = useState<GoalTypeInfo[]>([]);
  const [selected, setSelected] = useState<GoalDetail | null>(null);
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
      const [detail, acts] = await Promise.all([getGoal(id), goalActivities(id)]);
      setSelected(detail);
      setHistory(acts);
    } catch (e) {
      setError(errMsg(e));
    }
  }

  if (loading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (!user) {
    return (
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">Goals</h1>
        <p className="text-sm text-slate-500">
          Sign in to track goals.{" "}
          <Link to="/login" className="underline">
            Go to sign in
          </Link>
        </p>
      </div>
    );
  }

  const typeLabel = (t: string) => catalog.find((c) => c.type === t)?.label ?? t;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold">Goals</h1>
        <button
          onClick={() => setShowCreate((s) => !s)}
          className="ml-auto flex items-center gap-1 rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-slate-100 dark:text-slate-900"
          aria-expanded={showCreate}
        >
          <Plus size={14} /> New goal
        </button>
      </div>

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
        className="flex flex-wrap items-center gap-2"
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
          className="min-w-40 flex-1 rounded-lg border border-slate-200 bg-transparent px-2 py-1.5 text-sm dark:border-slate-700"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label="Filter by status"
          className="rounded-lg border border-slate-200 bg-transparent px-2 py-1.5 text-sm dark:border-slate-700"
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <select
          value={goalType}
          onChange={(e) => setGoalType(e.target.value)}
          aria-label="Filter by goal type"
          className="rounded-lg border border-slate-200 bg-transparent px-2 py-1.5 text-sm dark:border-slate-700"
        >
          <option value="">All types</option>
          {catalog.map((c) => (
            <option key={c.type} value={c.type}>
              {c.label}
            </option>
          ))}
        </select>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          aria-label="Sort goals"
          className="rounded-lg border border-slate-200 bg-transparent px-2 py-1.5 text-sm dark:border-slate-700"
        >
          <option value="target_date">Deadline</option>
          <option value="progress">Progress</option>
          <option value="created_at">Recently created</option>
          <option value="title">Title</option>
        </select>
        <button
          type="submit"
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm dark:border-slate-700"
        >
          Apply
        </button>
      </form>

      {busy && goals.length === 0 ? (
        <p className="text-sm text-slate-500">Loading goals…</p>
      ) : goals.length === 0 ? (
        <p className="text-sm text-slate-500">
          No goals yet. Create one above — courses, assignments, coding practice, projects, reading, or
          anything custom.
        </p>
      ) : (
        <ul className="grid gap-2 md:grid-cols-2">
          {goals.map((g) => (
            <li
              key={g.id}
              className={`rounded-xl border p-3 dark:border-slate-800 ${
                selected?.id === g.id ? "border-slate-400" : "border-slate-200"
              }`}
            >
              <div className="flex items-center gap-2">
                <button
                  onClick={() => void openGoal(g.id)}
                  className="flex-1 truncate text-left font-medium hover:underline"
                >
                  {g.title}
                </button>
                <HealthBadge health={g.health} />
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {typeLabel(g.goal_type)}
                {g.category ? ` · ${g.category}` : ""} · due {formatDay(g.target_date)}
              </p>
              <div className="mt-2 flex items-center gap-2">
                <ProgressBar percent={g.progress.percent} />
                <span className="w-12 shrink-0 text-right text-xs">{g.progress.percent}%</span>
              </div>
              <p className="mt-1 text-xs text-slate-500">{g.progress.detail}</p>
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
            goalActivities(g.id)
              .then(setHistory)
              .catch((e) => setError(errMsg(e)));
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
  onCreated: (g: GoalDetail) => void;
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
    <form
      onSubmit={(e) => void submit(e)}
      className="flex flex-col gap-2 rounded-xl border border-slate-200 p-4 dark:border-slate-800"
    >
      <h2 className="font-semibold">New goal</h2>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          Goal type
          <select
            value={goalType}
            onChange={(e) => setGoalType(e.target.value)}
            className="rounded-lg border border-slate-200 bg-transparent px-2 py-1.5 dark:border-slate-700"
          >
            {catalog.map((c) => (
              <option key={c.type} value={c.type}>
                {c.label}
              </option>
            ))}
          </select>
          {info && (
            <span className="text-xs text-slate-500">
              Progress from {info.default_progress_source} · unit “{info.default_unit}”
            </span>
          )}
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Title
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            className="rounded-lg border border-slate-200 bg-transparent px-2 py-1.5 dark:border-slate-700"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Category (e.g. Machine Learning, Career)
          <input
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="rounded-lg border border-slate-200 bg-transparent px-2 py-1.5 dark:border-slate-700"
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="flex flex-col gap-1 text-sm">
            Priority
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className="rounded-lg border border-slate-200 bg-transparent px-2 py-1.5 dark:border-slate-700"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Target date
            <input
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
              className="rounded-lg border border-slate-200 bg-transparent px-2 py-1.5 dark:border-slate-700"
            />
          </label>
        </div>
        <label className="flex flex-col gap-1 text-sm sm:col-span-2">
          Description
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="rounded-lg border border-slate-200 bg-transparent px-2 py-1.5 dark:border-slate-700"
          />
        </label>
        {(goalType === "coding" || goalType === "reading" || goalType === "custom") && (
          <label className="flex flex-col gap-1 text-sm">
            Measurable target (e.g. 50 problems, 300 pages)
            <input
              type="number"
              min={1}
              value={targetValue}
              onChange={(e) => setTargetValue(e.target.value)}
              className="rounded-lg border border-slate-200 bg-transparent px-2 py-1.5 dark:border-slate-700"
            />
          </label>
        )}
      </div>
      <button
        type="submit"
        disabled={busy}
        className="self-start rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
      >
        {busy ? "Creating…" : "Create goal"}
      </button>
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
  goal: GoalDetail;
  history: ActivityItem[];
  typeLabel: (t: string) => string;
  onChanged: (g: GoalDetail) => void;
  onDeleted: () => void;
  onClose: () => void;
  notify: (msg: string | null, isError?: boolean) => void;
}) {
  const [title, setTitle] = useState(goal.title);
  const [currentValue, setCurrentValue] = useState(String(goal.current_value));
  const [notes, setNotes] = useState(goal.notes);
  const [newTask, setNewTask] = useState("");
  const [newTaskDue, setNewTaskDue] = useState("");
  const [newMilestone, setNewMilestone] = useState("");
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
      onChanged(await getGoal(goal.id));
    } catch (e) {
      notify(errMsg(e), true);
    }
  }

  async function toggleMilestone(m: MilestoneItem) {
    const next = m.status === "completed" ? "not_started" : "completed";
    try {
      await updateMilestone(m.id, { status: next });
      onChanged(await getGoal(goal.id));
    } catch (e) {
      notify(errMsg(e), true);
    }
  }

  const showManualCounter = goal.progress_source === "manual";

  return (
    <section aria-label="Goal details" className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
      <div className="flex items-center gap-2">
        <h2 className="flex-1 truncate font-bold">{goal.title}</h2>
        <HealthBadge health={goal.health} />
        <button onClick={onClose} className="text-sm underline" aria-label="Close goal details">
          Close
        </button>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        {typeLabel(goal.goal_type)}
        {goal.category ? ` · ${goal.category}` : ""} · priority {goal.priority} · due{" "}
        {formatDay(goal.target_date)}
      </p>

      <div className="mt-3 flex items-center gap-2">
        <ProgressBar percent={goal.progress.percent} />
        <span className="text-sm font-medium">{goal.progress.percent}%</span>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        {goal.progress.detail} · source: {goal.progress.source_used}
      </p>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <h3 className="font-semibold">Details</h3>
          <label className="flex flex-col gap-1 text-sm">
            Title
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="rounded-lg border border-slate-200 bg-transparent px-2 py-1.5 dark:border-slate-700"
            />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-sm">
              Status
              <select
                value={goal.status}
                onChange={(e) => void save({ status: e.target.value }, "Status updated.")}
                className="rounded-lg border border-slate-200 bg-transparent px-2 py-1.5 dark:border-slate-700"
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Priority
              <select
                value={goal.priority}
                onChange={(e) => void save({ priority: e.target.value })}
                className="rounded-lg border border-slate-200 bg-transparent px-2 py-1.5 dark:border-slate-700"
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-sm">
              Target date
              <input
                type="date"
                value={goal.target_date ?? ""}
                onChange={(e) => void save({ target_date: e.target.value || null })}
                className="rounded-lg border border-slate-200 bg-transparent px-2 py-1.5 dark:border-slate-700"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Reminder (optional)
              <input
                type="datetime-local"
                value={goal.reminder_at ? goal.reminder_at.slice(0, 16) : ""}
                onChange={(e) => void save({ reminder_at: e.target.value || null })}
                className="rounded-lg border border-slate-200 bg-transparent px-2 py-1.5 dark:border-slate-700"
              />
            </label>
          </div>
          {showManualCounter && (
            <form
              className="flex items-end gap-2"
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
                Current progress ({goal.unit}, target {fmtNum(goal.target_value)})
                <input
                  type="number"
                  min={0}
                  step="any"
                  value={currentValue}
                  onChange={(e) => setCurrentValue(e.target.value)}
                  className="rounded-lg border border-slate-200 bg-transparent px-2 py-1.5 dark:border-slate-700"
                />
              </label>
              <button
                type="submit"
                className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm dark:border-slate-700"
              >
                Record
              </button>
            </form>
          )}
          <label className="flex flex-col gap-1 text-sm">
            Notes
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="rounded-lg border border-slate-200 bg-transparent px-2 py-1.5 dark:border-slate-700"
            />
          </label>
          <div className="flex gap-2">
            <button
              onClick={() => void save({ title: title.trim() || goal.title, notes })}
              className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-slate-100 dark:text-slate-900"
            >
              Save title & notes
            </button>
            {!confirmDelete ? (
              <button
                onClick={() => setConfirmDelete(true)}
                className="rounded-lg border border-red-300 px-3 py-1.5 text-sm text-red-600"
              >
                Delete goal
              </button>
            ) : (
              <>
                <button
                  onClick={() =>
                    deleteGoal(goal.id)
                      .then(onDeleted)
                      .catch((e) => notify(errMsg(e), true))
                  }
                  className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white"
                >
                  Confirm delete
                </button>
                <button onClick={() => setConfirmDelete(false)} className="text-sm underline">
                  Cancel
                </button>
              </>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <h4 className="text-sm font-semibold">Links</h4>
            {goal.external_links.length === 0 && (
              <p className="text-xs text-slate-500">No links yet.</p>
            )}
            <ul className="flex flex-col gap-1">
              {goal.external_links.map((l, i) => (
                <li key={`${l.url}-${i}`} className="flex items-center gap-2 text-sm">
                  <a
                    href={l.url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex-1 truncate underline"
                  >
                    {l.label}
                  </a>
                  <button
                    onClick={() =>
                      void save({ external_links: goal.external_links.filter((_, j) => j !== i) })
                    }
                    className="text-xs text-red-600 underline"
                    aria-label={`Remove link ${l.label}`}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
            <form
              className="flex gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                if (!newLinkLabel.trim() || !newLinkUrl.trim()) return;
                void save(
                  {
                    external_links: [
                      ...goal.external_links,
                      { label: newLinkLabel.trim(), url: newLinkUrl.trim() },
                    ],
                  },
                  "Link added.",
                );
                setNewLinkLabel("");
                setNewLinkUrl("");
              }}
            >
              <input
                value={newLinkLabel}
                onChange={(e) => setNewLinkLabel(e.target.value)}
                placeholder="Label"
                aria-label="Link label"
                className="w-24 rounded border border-slate-200 bg-transparent px-1 py-1 text-sm dark:border-slate-700"
              />
              <input
                value={newLinkUrl}
                onChange={(e) => setNewLinkUrl(e.target.value)}
                placeholder="https://…"
                aria-label="Link URL"
                className="flex-1 rounded border border-slate-200 bg-transparent px-1 py-1 text-sm dark:border-slate-700"
              />
              <button type="submit" className="text-sm underline">
                Add
              </button>
            </form>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div>
            <h3 className="font-semibold">
              Tasks ({goal.tasks_done}/{goal.task_count})
            </h3>
            {goal.tasks.length === 0 ? (
              <p className="text-xs text-slate-500">
                {goal.progress_source === "tasks"
                  ? "Add lectures/subtasks — goal progress derives from these."
                  : "No tasks. Add some to break the work down."}
              </p>
            ) : (
              <ul className="mt-1 flex flex-col gap-1">
                {goal.tasks.map((t) => (
                  <li
                    key={t.id}
                    className="flex items-center gap-2 rounded-lg border border-slate-200 px-2 py-1.5 text-sm dark:border-slate-800"
                  >
                    <button
                      onClick={() => void toggleTask(t)}
                      aria-label={t.status === "done" ? `Reopen ${t.title}` : `Complete ${t.title}`}
                      aria-pressed={t.status === "done"}
                    >
                      {t.status === "done" ? (
                        <CheckCircle2 size={16} className="text-green-600" />
                      ) : (
                        <Circle size={16} className="text-slate-400" />
                      )}
                    </button>
                    <span className={`flex-1 truncate ${t.status === "done" ? "line-through text-slate-500" : ""}`}>
                      {t.title}
                    </span>
                    {t.due_date && <span className="text-xs text-slate-500">{formatDay(t.due_date)}</span>}
                    <button
                      onClick={() =>
                        deleteTask(t.id)
                          .then(() => getGoal(goal.id))
                          .then(onChanged)
                          .catch((e) => notify(errMsg(e), true))
                      }
                      className="text-xs text-red-600 underline"
                      aria-label={`Delete task ${t.title}`}
                    >
                      <Trash2 size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <form
              className="mt-1 flex gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                if (!newTask.trim()) return;
                createTask(goal.id, { title: newTask.trim(), due_date: newTaskDue || null })
                  .then(() => getGoal(goal.id))
                  .then(onChanged)
                  .catch((err) => notify(errMsg(err), true));
                setNewTask("");
                setNewTaskDue("");
              }}
            >
              <input
                value={newTask}
                onChange={(e) => setNewTask(e.target.value)}
                placeholder="New task"
                aria-label="New task title"
                className="flex-1 rounded border border-slate-200 bg-transparent px-2 py-1 text-sm dark:border-slate-700"
              />
              <input
                type="date"
                value={newTaskDue}
                onChange={(e) => setNewTaskDue(e.target.value)}
                aria-label="New task due date"
                className="rounded border border-slate-200 bg-transparent px-1 py-1 text-sm dark:border-slate-700"
              />
              <button type="submit" className="text-sm underline">
                Add
              </button>
            </form>
          </div>

          <div>
            <h3 className="font-semibold">
              Milestones ({goal.milestones_done}/{goal.milestone_count})
            </h3>
            {goal.milestones.length === 0 ? (
              <p className="text-xs text-slate-500">No milestones yet.</p>
            ) : (
              <ul className="mt-1 flex flex-col gap-1">
                {goal.milestones.map((m) => (
                  <li
                    key={m.id}
                    className="flex items-center gap-2 rounded-lg border border-slate-200 px-2 py-1.5 text-sm dark:border-slate-800"
                  >
                    <button
                      onClick={() => void toggleMilestone(m)}
                      aria-label={m.status === "completed" ? `Reopen ${m.title}` : `Complete ${m.title}`}
                      aria-pressed={m.status === "completed"}
                    >
                      {m.status === "completed" ? (
                        <CheckCircle2 size={16} className="text-green-600" />
                      ) : (
                        <Circle size={16} className="text-slate-400" />
                      )}
                    </button>
                    <span className={`flex-1 truncate ${m.status === "completed" ? "line-through text-slate-500" : ""}`}>
                      {m.title}
                    </span>
                    {m.due_date && <span className="text-xs text-slate-500">{formatDay(m.due_date)}</span>}
                    <button
                      onClick={() =>
                        deleteMilestone(m.id)
                          .then(() => getGoal(goal.id))
                          .then(onChanged)
                          .catch((e) => notify(errMsg(e), true))
                      }
                      className="text-xs text-red-600 underline"
                      aria-label={`Delete milestone ${m.title}`}
                    >
                      <Trash2 size={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <form
              className="mt-1 flex gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                if (!newMilestone.trim()) return;
                createMilestone(goal.id, { title: newMilestone.trim() })
                  .then(() => getGoal(goal.id))
                  .then(onChanged)
                  .catch((err) => notify(errMsg(err), true));
                setNewMilestone("");
              }}
            >
              <input
                value={newMilestone}
                onChange={(e) => setNewMilestone(e.target.value)}
                placeholder="New milestone"
                aria-label="New milestone title"
                className="flex-1 rounded border border-slate-200 bg-transparent px-2 py-1 text-sm dark:border-slate-700"
              />
              <button type="submit" className="text-sm underline">
                Add
              </button>
            </form>
          </div>

          <div>
            <h3 className="font-semibold">Activity history ({history.length})</h3>
            {history.length === 0 ? (
              <p className="text-xs text-slate-500">No activity recorded for this goal yet.</p>
            ) : (
              <ul className="mt-1 flex max-h-48 flex-col gap-1 overflow-auto text-sm">
                {history.map((a) => (
                  <li key={a.id} className="rounded border border-slate-100 px-2 py-1 text-xs dark:border-slate-800">
                    <span className="font-medium">{a.title}</span>{" "}
                    <span className="text-slate-500">
                      · {a.activity_type} · {a.source} · {new Date(a.occurred_at).toLocaleString()}
                    </span>
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
