import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { BellRing, ChevronLeft, ChevronRight } from "lucide-react";
import { ApiError, calendarEvents, upcomingReminders } from "../lib/api";
import type { CalendarEvent, Reminder } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Badge, EmptyState, PageHeader, Spinner, cardCls } from "../components/ui";

const KIND_TONES: Record<string, "blue" | "green" | "violet" | "amber" | "slate"> = {
  task: "blue",
  goal: "green",
  milestone: "violet",
  reminder: "amber",
  activity: "slate",
};
const KIND_DOTS: Record<string, string> = {
  task: "bg-blue-500",
  goal: "bg-green-500",
  milestone: "bg-violet-500",
  reminder: "bg-amber-500",
  activity: "bg-slate-300",
};

const ALL_KINDS = ["task", "goal", "milestone", "reminder", "activity"];

function errMsg(e: unknown): string {
  return e instanceof ApiError ? e.message : "Something went wrong";
}

function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function eventLink(e: CalendarEvent): string | null {
  if (e.goal_id) return `/goals?open=${e.goal_id}`;
  return null;
}

export default function Calendar() {
  const { user, loading } = useAuth();
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [kinds, setKinds] = useState<string[]>(ALL_KINDS);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const range = useMemo(() => {
    const first = new Date(cursor.year, cursor.month, 1);
    const start = new Date(first);
    start.setDate(1 - ((first.getDay() + 6) % 7)); // Monday-first grid
    const end = new Date(start);
    end.setDate(start.getDate() + 41);
    return { start: isoDay(start), end: isoDay(end) };
  }, [cursor]);

  const load = useCallback(async () => {
    const [evts, rems] = await Promise.all([
      calendarEvents(range.start, range.end, kinds.join(",")),
      upcomingReminders(30),
    ]);
    setEvents(evts);
    setReminders(rems);
  }, [range, kinds]);

  useEffect(() => {
    if (!user) return;
    load().catch((e) => setError(errMsg(e)));
  }, [user, load]);

  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of events) {
      if (!map.has(e.date)) map.set(e.date, []);
      map.get(e.date)?.push(e);
    }
    return map;
  }, [events]);

  const cells: string[] = useMemo(() => {
    const [y, m, d] = range.start.split("-").map(Number);
    const start = new Date(y, m - 1, d);
    return Array.from({ length: 42 }, (_, i) => {
      const day = new Date(start);
      day.setDate(start.getDate() + i);
      return isoDay(day);
    });
  }, [range]);

  const monthName = new Date(cursor.year, cursor.month, 1).toLocaleString(undefined, {
    month: "long",
    year: "numeric",
  });

  if (loading) return <Spinner />;
  if (!user) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Calendar" sub="Sign in to see your schedule." />
        <EmptyState
          title="You're signed out"
          action={<Link to="/login" className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white">Sign in</Link>}
        />
      </div>
    );
  }

  const agenda = (selectedDay ? (byDay.get(selectedDay) ?? []) : []).slice().sort((a, b) =>
    a.kind.localeCompare(b.kind),
  );

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Calendar"
        sub="Deadlines, reminders, and recorded work in one month view."
        actions={
          <div className="flex items-center gap-1">
            <button
              onClick={() => setCursor((c) => ({ year: c.month === 0 ? c.year - 1 : c.year, month: (c.month + 11) % 12 }))}
              className="rounded-lg border border-slate-200 p-1.5 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
              aria-label="Previous month"
            >
              <ChevronLeft size={15} />
            </button>
            <span className="fm-num min-w-36 text-center text-sm font-semibold">{monthName}</span>
            <button
              onClick={() => setCursor((c) => ({ year: c.month === 11 ? c.year + 1 : c.year, month: (c.month + 1) % 12 }))}
              className="rounded-lg border border-slate-200 p-1.5 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
              aria-label="Next month"
            >
              <ChevronRight size={15} />
            </button>
            <button
              onClick={() => {
                const now = new Date();
                setCursor({ year: now.getFullYear(), month: now.getMonth() });
              }}
              className="ml-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
            >
              Today
            </button>
          </div>
        }
      />

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </div>
      )}

      <div className={`${cardCls} flex flex-wrap items-center gap-1.5 p-2.5`}>
        {ALL_KINDS.map((k) => (
          <button
            key={k}
            onClick={() => setKinds((ks) => (ks.includes(k) ? ks.filter((x) => x !== k) : [...ks, k]))}
            aria-pressed={kinds.includes(k)}
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
              kinds.includes(k)
                ? "border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-800"
                : "border-slate-200 text-slate-400 opacity-60 dark:border-slate-800"
            }`}
          >
            <span className={`inline-block h-2 w-2 rounded-full ${KIND_DOTS[k]}`} aria-hidden />
            {k}s
          </button>
        ))}
      </div>

      {reminders.length > 0 && (
        <section aria-label="Upcoming reminders" className="rounded-xl border border-amber-200 bg-amber-50 p-3.5 dark:border-amber-900 dark:bg-amber-950/50">
          <h2 className="flex items-center gap-1.5 text-[13px] font-bold uppercase tracking-wide text-amber-800 dark:text-amber-200">
            <BellRing size={14} aria-hidden /> Reminders · next 30 days
          </h2>
          <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
            {reminders.map((r) => (
              <li key={r.goal_id} className="flex items-center gap-2 rounded-lg bg-white/70 px-2.5 py-1.5 dark:bg-slate-900/60">
                <span className="min-w-0 flex-1 truncate font-medium">{r.goal_title}</span>
                <span className="fm-num shrink-0 text-xs text-slate-500">{new Date(r.reminder_at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                <Link to={`/goals?open=${r.goal_id}`} className="shrink-0 text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-300">
                  Open
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className={`${cardCls} fm-fade overflow-hidden !p-0`}>
        <div className="grid grid-cols-7 border-b border-slate-200 text-center text-[11px] font-bold uppercase tracking-wide text-slate-400 dark:border-slate-800" aria-hidden>
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
            <div key={d} className="py-2">{d}</div>
          ))}
        </div>
        <div className="grid grid-cols-7" role="grid" aria-label={monthName}>
          {cells.map((day, idx) => {
            const inMonth = day.startsWith(`${cursor.year}-${String(cursor.month + 1).padStart(2, "0")}`);
            const dayEvents = byDay.get(day) ?? [];
            const isToday = day === isoDay(new Date());
            const isSel = selectedDay === day;
            const lastRow = idx >= 35;
            const lastCol = idx % 7 === 6;
            return (
              <button
                key={day}
                role="gridcell"
                aria-label={`${day}, ${dayEvents.length} events`}
                aria-selected={isSel}
                onClick={() => setSelectedDay(isSel ? null : day)}
                className={`flex min-h-[68px] flex-col gap-1 border-slate-100 p-1.5 text-left transition-colors hover:bg-slate-50 sm:min-h-[84px] sm:p-2 dark:border-slate-800 dark:hover:bg-slate-800/50 ${
                  lastRow ? "" : "border-b"
                } ${lastCol ? "" : "border-r"} ${
                  inMonth ? "" : "bg-slate-50/60 opacity-50 dark:bg-slate-900/40"
                } ${isToday ? "bg-indigo-50/60 dark:bg-indigo-950/40" : ""} ${
                  isSel ? "bg-indigo-50 outline outline-2 outline-indigo-400 dark:bg-indigo-950/60" : ""
                }`}
              >
                <span className={`fm-num flex h-5 w-5 items-center justify-center rounded-full text-xs font-semibold ${isToday ? "bg-indigo-600 text-white" : "text-slate-500"}`}>
                  {Number(day.slice(8))}
                </span>
                <span className="hidden flex-col gap-0.5 sm:flex">
                  {dayEvents.slice(0, 3).map((e) => (
                    <span key={e.id} className="truncate rounded px-1 py-px text-[10px] leading-tight" title={e.title}>
                      <i className={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${KIND_DOTS[e.kind] ?? "bg-slate-300"}`} aria-hidden />
                      {e.title}
                    </span>
                  ))}
                  {dayEvents.length > 3 && (
                    <span className="fm-num px-1 text-[10px] text-slate-400">+{dayEvents.length - 3} more</span>
                  )}
                </span>
                <span className="flex gap-0.5 sm:hidden" aria-hidden>
                  {dayEvents.slice(0, 4).map((e) => (
                    <i key={e.id} className={`h-1.5 w-1.5 rounded-full ${KIND_DOTS[e.kind] ?? "bg-slate-300"}`} />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <section aria-label="Day agenda" className={`${cardCls} p-4`}>
        <h2 className="text-[15px] font-bold tracking-tight">
          {selectedDay ? `Agenda — ${new Date(`${selectedDay}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}` : "Agenda"}
        </h2>
        {!selectedDay ? (
          <p className="mt-1 text-sm text-slate-400">Select a day to see everything scheduled and recorded.</p>
        ) : agenda.length === 0 ? (
          <p className="mt-1 text-sm text-slate-400">Nothing scheduled or recorded this day.</p>
        ) : (
          <ul className="mt-2 flex flex-col divide-y divide-slate-100 dark:divide-slate-800">
            {agenda.map((e) => (
              <li key={e.id} className="flex items-center gap-2.5 py-2 first:pt-0 last:pb-0 text-sm">
                <Badge tone={KIND_TONES[e.kind] ?? "slate"}>{e.kind}</Badge>
                <span className="min-w-0 flex-1 truncate font-medium">{e.title}</span>
                {e.datetime && (
                  <span className="fm-num shrink-0 text-xs text-slate-400">
                    {new Date(e.datetime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                )}
                {eventLink(e) && (
                  <Link to={eventLink(e) as string} className="shrink-0 text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-300">
                    Open goal
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
