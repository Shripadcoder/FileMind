import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  ACTIVITY_TYPE_LABELS,
  ApiError,
  HEALTH_LABELS,
  dashboardSummary,
  fmtNum,
  formatDay,
} from "../lib/api";
import type { DashboardSummary } from "../lib/api";
import { useAuth } from "../lib/auth";

function errMsg(e: unknown): string {
  return e instanceof ApiError ? e.message : "Something went wrong";
}

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className="rounded-xl border border-slate-200 p-4 dark:border-slate-800"
    >
      <h2 className="font-semibold">{title}</h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
    </div>
  );
}

function MiniBar({ percent }: { percent: number }) {
  return (
    <div className="h-1.5 w-24 overflow-hidden rounded bg-slate-200 dark:bg-slate-700" aria-hidden>
      <div className="h-full rounded bg-slate-900 dark:bg-slate-100" style={{ width: `${percent}%` }} />
    </div>
  );
}

function heatColor(count: number): string {
  if (count === 0) return "bg-slate-100 dark:bg-slate-800";
  if (count <= 2) return "bg-green-200 dark:bg-green-900";
  if (count <= 5) return "bg-green-300 dark:bg-green-700";
  return "bg-green-500 dark:bg-green-500";
}

export default function Dashboard() {
  const { user, loading } = useAuth();
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState("");
  const [rangeDays, setRangeDays] = useState("30");

  const load = useCallback(async () => {
    const days = Number(rangeDays);
    const to = new Date();
    const from = new Date();
    from.setDate(to.getDate() - (days - 1));
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    setData(
      await dashboardSummary({
        category: category || undefined,
        activity_from: iso(from),
        activity_to: iso(to),
      }),
    );
  }, [category, rangeDays]);

  useEffect(() => {
    if (!user) return;
    load().catch((e) => setError(errMsg(e)));
  }, [user, load]);

  if (loading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (!user) {
    return (
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-sm text-slate-500">
          Sign in to see your productivity overview.{" "}
          <Link to="/login" className="underline">
            Go to sign in
          </Link>
        </p>
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      </div>
    );
  }
  if (!data) return <p className="text-sm text-slate-500">Loading dashboard…</p>;

  const categories = data.progress_by_category.map((c) => c.category);
  const hasGoals = data.active_goals + data.completed_goals + data.on_hold_goals > 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-slate-500">Computed from your goals, tasks, files, and activity.</p>
        </div>
        <div className="ml-auto flex gap-2">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            aria-label="Filter by goal category"
            className="rounded-lg border border-slate-200 bg-transparent px-2 py-1.5 text-sm dark:border-slate-700"
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            value={rangeDays}
            onChange={(e) => setRangeDays(e.target.value)}
            aria-label="Activity range"
            className="rounded-lg border border-slate-200 bg-transparent px-2 py-1.5 text-sm dark:border-slate-700"
          >
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
          </select>
        </div>
      </div>

      {!hasGoals && data.recent_files.length === 0 && (
        <div className="rounded-xl border border-slate-200 p-4 text-sm dark:border-slate-800">
          <p className="font-semibold">Welcome to FileMind</p>
          <p className="mt-1 text-slate-500">
            Get started:{" "}
            <Link to="/files" className="underline">
              upload a file
            </Link>
            ,{" "}
            <Link to="/goals" className="underline">
              create a goal
            </Link>
            , or{" "}
            <Link to="/activity" className="underline">
              log your first activity
            </Link>
            . This dashboard fills in as you record real work.
          </p>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Active goals" value={data.active_goals} />
        <Stat label="Completed goals" value={data.completed_goals} />
        <Stat label="Overdue items" value={data.overdue_goals.length + data.overdue_tasks.length} />
        <Stat label="Due today" value={data.today_items.length} />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card title={`Today's tasks (${data.today_items.length})`}>
          {data.today_items.length === 0 ? (
            <p className="text-sm text-slate-500">Nothing due today. Enjoy the clear schedule.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {data.today_items.map((t) => (
                <li key={t.id} className="flex items-center gap-2">
                  <span className="flex-1 truncate font-medium">{t.title}</span>
                  <Link to="/goals" className="truncate text-xs text-slate-500 underline">
                    {t.goal_title}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title={`Overdue (${data.overdue_goals.length + data.overdue_tasks.length})`}>
          {data.overdue_goals.length + data.overdue_tasks.length === 0 ? (
            <p className="text-sm text-slate-500">Nothing overdue.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {data.overdue_tasks.map((t) => (
                <li key={`t-${t.id}`} className="flex items-center gap-2">
                  <span className="rounded bg-red-100 px-1 text-xs text-red-800">task</span>
                  <span className="flex-1 truncate">{t.title}</span>
                  <span className="text-xs text-slate-500">due {formatDay(t.due_date)}</span>
                </li>
              ))}
              {data.overdue_goals.map((g) => (
                <li key={`g-${g.id}`} className="flex items-center gap-2">
                  <span className="rounded bg-red-100 px-1 text-xs text-red-800">goal</span>
                  <span className="flex-1 truncate">{g.title}</span>
                  <span className="text-xs text-slate-500">due {formatDay(g.target_date)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card title="Weekly activity">
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.weekly_activity}>
                <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(d: string) => d.slice(5)} />
                <YAxis allowDecimals={false} width={30} />
                <Tooltip />
                <Bar dataKey="count" name="Events" fill="#334155" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          {data.activity_by_type.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
              {data.activity_by_type.map((t) => (
                <li key={t.activity_type} className="rounded bg-slate-100 px-2 py-0.5 dark:bg-slate-800">
                  {ACTIVITY_TYPE_LABELS[t.activity_type] ?? t.activity_type}: {t.count}
                  {t.total_value > 0 ? ` (+${fmtNum(t.total_value)})` : ""}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Progress by category">
          {data.progress_by_category.length === 0 ? (
            <p className="text-sm text-slate-500">No active goals to summarize.</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {data.progress_by_category.map((c) => (
                <li key={c.category} className="flex items-center gap-2">
                  <span className="w-32 truncate font-medium">{c.category}</span>
                  <MiniBar percent={c.avg_progress} />
                  <span className="text-xs text-slate-500">
                    {c.avg_progress}% · {c.goals} goal{c.goals === 1 ? "" : "s"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <Card title={`Courses (${data.courses.length})`}>
          {data.courses.length === 0 ? (
            <p className="text-sm text-slate-500">No course goals.</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {data.courses.map((c) => (
                <li key={c.id}>
                  <div className="flex items-center gap-2">
                    <span className="flex-1 truncate font-medium">{c.title}</span>
                    <span className="text-xs text-slate-500">{c.progress}%</span>
                  </div>
                  <p className="text-xs text-slate-500">
                    {c.tasks_done}/{c.tasks_total} lectures · {HEALTH_LABELS[c.health] ?? c.health}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Coding practice">
          <ul className="flex flex-col gap-1 text-sm">
            <li>
              Problems solved (all time): <strong>{fmtNum(data.coding.problems_solved_total)}</strong>
            </li>
            <li>
              Problems this week: <strong>{fmtNum(data.coding.problems_this_week)}</strong>
            </li>
            <li>
              Active coding goals: <strong>{data.coding.active_goals}</strong>
            </li>
          </ul>
        </Card>
        <Card title={`Projects (${data.projects.length})`}>
          {data.projects.length === 0 ? (
            <p className="text-sm text-slate-500">No project goals.</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {data.projects.map((p) => (
                <li key={p.id}>
                  <div className="flex items-center gap-2">
                    <span className="flex-1 truncate font-medium">{p.title}</span>
                    <span className="text-xs text-slate-500">{p.progress}%</span>
                  </div>
                  <p className="text-xs text-slate-500">
                    {p.milestones_done}/{p.milestones_total} milestones
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card title={`Recent files (${data.recent_files.length})`}>
          {data.recent_files.length === 0 ? (
            <p className="text-sm text-slate-500">
              No uploads yet.{" "}
              <Link to="/files" className="underline">
                Go to My Files
              </Link>
            </p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {data.recent_files.map((f) => (
                <li key={f.id} className="flex items-center gap-2">
                  <span className="flex-1 truncate">{f.original_filename}</span>
                  <span className="text-xs text-slate-500">{f.category_name ?? "Uncategorized"}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Recent goal updates">
          {data.recent_activities.length === 0 ? (
            <p className="text-sm text-slate-500">
              No activity yet.{" "}
              <Link to="/activity" className="underline">
                Log your first entry
              </Link>
            </p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {data.recent_activities.slice(0, 6).map((a) => (
                <li key={a.id} className="flex items-center gap-2">
                  <span className="flex-1 truncate">{a.title}</span>
                  <span className="text-xs text-slate-500">
                    {ACTIVITY_TYPE_LABELS[a.activity_type] ?? a.activity_type}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title="Activity history (last 90 days)">
        <div
          className="grid grid-flow-col grid-rows-7 gap-1 overflow-x-auto"
          role="img"
          aria-label="Activity calendar heatmap"
        >
          {data.activity_calendar.map((d) => (
            <div
              key={d.date}
              title={`${d.date}: ${d.count} event${d.count === 1 ? "" : "s"}`}
              className={`h-4 w-4 rounded-sm ${heatColor(d.count)}`}
            />
          ))}
        </div>
        <p className="mt-1 text-xs text-slate-500">Darker green means more recorded activity.</p>
      </Card>
    </div>
  );
}
