import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertCircle, CalendarCheck, CheckCircle2, Flame, Target } from "lucide-react";
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
import { Badge, EmptyState, PageHeader, ProgressBar, Spinner, cardCls, inputCls } from "../components/ui";

function errMsg(e: unknown): string {
  return e instanceof ApiError ? e.message : "Something went wrong";
}

function StatCard({
  icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  sub: string;
  tone: string;
}) {
  return (
    <div className={`${cardCls} flex items-center gap-3 p-4`}>
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${tone}`} aria-hidden>
        {icon}
      </span>
      <span className="min-w-0">
        <span className="fm-num block text-2xl font-bold leading-none tracking-tight">{value}</span>
        <span className="mt-1 block text-[13px] font-medium text-slate-500 dark:text-slate-400">{label}</span>
        <span className="block truncate text-xs text-slate-400">{sub}</span>
      </span>
    </div>
  );
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section aria-label={title} className={`${cardCls} p-4 md:p-5`}>
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-[15px] font-bold tracking-tight">{title}</h2>
        {action && <span className="ml-auto">{action}</span>}
      </div>
      {children}
    </section>
  );
}

function heatColor(count: number): string {
  if (count === 0) return "bg-slate-100 dark:bg-slate-800";
  if (count <= 2) return "bg-green-200 dark:bg-green-900";
  if (count <= 5) return "bg-green-300 dark:bg-green-700";
  return "bg-green-500";
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

  if (loading) return <Spinner />;
  if (!user) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Dashboard" sub="Sign in to see your productivity overview." />
        <EmptyState
          title="You're signed out"
          hint="Sign in to load your goals, files, and activity."
          action={<Link to="/login" className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white">Sign in</Link>}
        />
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Dashboard" />
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </div>
      </div>
    );
  }
  if (!data) return <Spinner label="Loading dashboard…" />;

  const categories = data.progress_by_category.map((c) => c.category);
  const hasGoals = data.active_goals + data.completed_goals + data.on_hold_goals > 0;
  const overdueCount = data.overdue_goals.length + data.overdue_tasks.length;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Dashboard"
        sub="Live overview computed from your goals, tasks, files, and activity."
        actions={
          <>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              aria-label="Filter by goal category"
              className={inputCls}
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <select
              value={rangeDays}
              onChange={(e) => setRangeDays(e.target.value)}
              aria-label="Activity range"
              className={inputCls}
            >
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
            </select>
          </>
        }
      />

      {!hasGoals && data.recent_files.length === 0 && (
        <EmptyState
          title="Welcome to FileMind"
          hint="Upload a file, create a goal, or log your first activity — this dashboard fills in as you record real work."
          action={<Link to="/goals" className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white">Create your first goal</Link>}
        />
      )}

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <StatCard icon={<Target size={19} />} label="Active goals" value={data.active_goals} sub={`${data.completed_goals} completed`} tone="bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300" />
        <StatCard icon={<CheckCircle2 size={19} />} label="Completed" value={data.completed_goals} sub={`${data.on_hold_goals} on hold`} tone="bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300" />
        <StatCard icon={<AlertCircle size={19} />} label="Overdue" value={overdueCount} sub="goals + tasks past due" tone="bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300" />
        <StatCard icon={<CalendarCheck size={19} />} label="Due today" value={data.today_items.length} sub="open items needing action" tone="bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300" />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="flex flex-col gap-4 lg:col-span-3">
          <Section
            title={`Today's focus · ${data.today_items.length}`}
            action={<Link to="/goals" className="text-[13px] font-medium text-indigo-600 hover:underline dark:text-indigo-300">Manage goals</Link>}
          >
            {data.today_items.length === 0 ? (
              <p className="py-2 text-sm text-slate-500">Nothing due today — a clear schedule. Pull the nearest upcoming task forward if you want momentum.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-slate-100 dark:divide-slate-800">
                {data.today_items.map((t) => (
                  <li key={t.id} className="flex items-center gap-2.5 py-2 first:pt-0 last:pb-0">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-500" aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{t.title}</span>
                    <Link to="/goals" className="shrink-0 truncate text-xs text-slate-400 hover:underline">{t.goal_title}</Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Weekly activity">
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.weekly_activity} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#94a3b8" }} tickFormatter={(d: string) => d.slice(5)} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{ borderRadius: 10, fontSize: 12, border: "1px solid #e2e8f0" }}
                    labelFormatter={(d) => String(d)}
                  />
                  <Bar dataKey="count" name="Events" fill="#6366f1" radius={[5, 5, 0, 0]} maxBarSize={34} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            {data.activity_by_type.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {data.activity_by_type.map((t) => (
                  <Badge key={t.activity_type} tone="slate">
                    {ACTIVITY_TYPE_LABELS[t.activity_type] ?? t.activity_type} · {t.count}
                    {t.total_value > 0 ? ` (+${fmtNum(t.total_value)})` : ""}
                  </Badge>
                ))}
              </div>
            )}
          </Section>

          <Section title="Progress by category">
            {data.progress_by_category.length === 0 ? (
              <p className="py-2 text-sm text-slate-500">No active goals to summarize.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {data.progress_by_category.map((c) => (
                  <li key={c.category}>
                    <div className="mb-1 flex items-baseline gap-2 text-sm">
                      <span className="min-w-0 flex-1 truncate font-medium">{c.category}</span>
                      <span className="fm-num text-xs text-slate-400">{c.avg_progress}% · {c.goals} goal{c.goals === 1 ? "" : "s"}</span>
                    </div>
                    <ProgressBar value={c.avg_progress} tone="health" />
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title={`Activity history · last 90 days`}>
            <div className="fm-scroll grid grid-flow-col grid-rows-7 gap-[3px] overflow-x-auto pb-1" role="img" aria-label="Activity calendar heatmap">
              {data.activity_calendar.map((d) => (
                <div key={d.date} title={`${d.date}: ${d.count} event${d.count === 1 ? "" : "s"}`} className={`h-3.5 w-3.5 rounded-[4px] ${heatColor(d.count)}`} />
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-400">Darker green means more recorded activity.</p>
          </Section>
        </div>

        <div className="flex flex-col gap-4 lg:col-span-2">
          {overdueCount > 0 && (
            <Section title={`Needs attention · ${overdueCount}`}>
              <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto fm-scroll">
                {data.overdue_tasks.map((t) => (
                  <li key={`t-${t.id}`} className="flex items-center gap-2 rounded-lg bg-red-50 px-2.5 py-1.5 text-sm dark:bg-red-950/40">
                    <Badge tone="red">task</Badge>
                    <span className="min-w-0 flex-1 truncate font-medium">{t.title}</span>
                    <span className="fm-num shrink-0 text-xs text-slate-500">due {formatDay(t.due_date)}</span>
                  </li>
                ))}
                {data.overdue_goals.map((g) => (
                  <li key={`g-${g.id}`} className="flex items-center gap-2 rounded-lg bg-red-50 px-2.5 py-1.5 text-sm dark:bg-red-950/40">
                    <Badge tone="red">goal</Badge>
                    <span className="min-w-0 flex-1 truncate font-medium">{g.title}</span>
                    <span className="fm-num shrink-0 text-xs text-slate-500">due {formatDay(g.target_date)}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section title={`Courses · ${data.courses.length}`}>
            {data.courses.length === 0 ? (
              <p className="py-1 text-sm text-slate-500">No course goals. <Link to="/goals" className="underline">Create one</Link>.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {data.courses.map((c) => (
                  <li key={c.id}>
                    <div className="mb-1 flex items-baseline gap-2 text-sm">
                      <span className="min-w-0 flex-1 truncate font-medium">{c.title}</span>
                      <Badge tone={c.health === "completed" ? "green" : c.health === "overdue" ? "red" : "blue"}>{HEALTH_LABELS[c.health] ?? c.health}</Badge>
                    </div>
                    <ProgressBar value={c.progress} />
                    <p className="fm-num mt-1 text-xs text-slate-400">{c.tasks_done}/{c.tasks_total} lectures · {c.progress}%</p>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Coding practice">
            <dl className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-slate-50 p-2.5 dark:bg-slate-800">
                <dt className="text-[11px] text-slate-400">All time</dt>
                <dd className="fm-num text-lg font-bold">{fmtNum(data.coding.problems_solved_total)}</dd>
              </div>
              <div className="rounded-lg bg-slate-50 p-2.5 dark:bg-slate-800">
                <dt className="text-[11px] text-slate-400">This week</dt>
                <dd className="fm-num text-lg font-bold">{fmtNum(data.coding.problems_this_week)}</dd>
              </div>
              <div className="rounded-lg bg-slate-50 p-2.5 dark:bg-slate-800">
                <dt className="text-[11px] text-slate-400">Active goals</dt>
                <dd className="fm-num text-lg font-bold">{data.coding.active_goals}</dd>
              </div>
            </dl>
          </Section>

          <Section title={`Projects · ${data.projects.length}`}>
            {data.projects.length === 0 ? (
              <p className="py-1 text-sm text-slate-500">No project goals.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {data.projects.map((p) => (
                  <li key={p.id}>
                    <div className="mb-1 flex items-baseline gap-2 text-sm">
                      <span className="min-w-0 flex-1 truncate font-medium">{p.title}</span>
                      <span className="fm-num text-xs text-slate-400">{p.progress}%</span>
                    </div>
                    <ProgressBar value={p.progress} />
                    <p className="fm-num mt-1 text-xs text-slate-400">{p.milestones_done}/{p.milestones_total} milestones</p>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Recent files" action={<Link to="/files" className="text-[13px] font-medium text-indigo-600 hover:underline dark:text-indigo-300">All files</Link>}>
            {data.recent_files.length === 0 ? (
              <p className="py-1 text-sm text-slate-500">No uploads yet.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-slate-100 dark:divide-slate-800">
                {data.recent_files.map((f) => (
                  <li key={f.id} className="flex items-center gap-2 py-1.5 first:pt-0 last:pb-0 text-sm">
                    <Link to={`/files?open=${f.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">{f.original_filename}</Link>
                    <span className="shrink-0 text-xs text-slate-400">{f.category_name ?? "Uncategorized"}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Recent updates" action={<Link to="/activity" className="text-[13px] font-medium text-indigo-600 hover:underline dark:text-indigo-300">Activity log</Link>}>
            {data.recent_activities.length === 0 ? (
              <p className="py-1 text-sm text-slate-500">No activity yet.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-slate-100 dark:divide-slate-800">
                {data.recent_activities.slice(0, 6).map((a) => (
                  <li key={a.id} className="flex items-center gap-2 py-1.5 first:pt-0 last:pb-0 text-sm">
                    {a.goal_id ? (
                      <Link to={`/goals?open=${a.goal_id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">{a.title}</Link>
                    ) : (
                      <span className="min-w-0 flex-1 truncate font-medium">{a.title}</span>
                    )}
                    <span className="shrink-0 text-xs text-slate-400">{ACTIVITY_TYPE_LABELS[a.activity_type] ?? a.activity_type}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>

      <p className="flex items-center gap-1.5 text-xs text-slate-400">
        <Flame size={13} /> Every number on this page is aggregated from your records at load time — no demo data.
      </p>
    </div>
  );
}
