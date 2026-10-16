import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, calendarEvents, upcomingReminders } from "../lib/api";
import type { CalendarEvent, Reminder } from "../lib/api";
import { useAuth } from "../lib/auth";

const KIND_COLORS: Record<string, string> = {
  task: "bg-blue-100 text-blue-800",
  goal: "bg-green-100 text-green-800",
  milestone: "bg-purple-100 text-purple-800",
  reminder: "bg-amber-100 text-amber-800",
  activity: "bg-slate-100 text-slate-600",
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

  if (loading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (!user) {
    return (
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">Calendar</h1>
        <p className="text-sm text-slate-500">
          Sign in to see your schedule.{" "}
          <Link to="/login" className="underline">
            Go to sign in
          </Link>
        </p>
      </div>
    );
  }

  const agenda = (selectedDay ? (byDay.get(selectedDay) ?? []) : []).slice().sort((a, b) =>
    a.kind.localeCompare(b.kind),
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold">Calendar</h1>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => setCursor((c) => ({ year: c.month === 0 ? c.year - 1 : c.year, month: (c.month + 11) % 12 }))}
            className="rounded border border-slate-200 px-2 py-1 text-sm dark:border-slate-700"
            aria-label="Previous month"
          >
            ←
          </button>
          <span className="min-w-36 text-center text-sm font-medium">{monthName}</span>
          <button
            onClick={() => setCursor((c) => ({ year: c.month === 11 ? c.year + 1 : c.year, month: (c.month + 1) % 12 }))}
            className="rounded border border-slate-200 px-2 py-1 text-sm dark:border-slate-700"
            aria-label="Next month"
          >
            →
          </button>
          <button
            onClick={() => {
              const now = new Date();
              setCursor({ year: now.getFullYear(), month: now.getMonth() });
            }}
            className="rounded border border-slate-200 px-2 py-1 text-sm dark:border-slate-700"
          >
            Today
          </button>
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 text-sm">
        {ALL_KINDS.map((k) => (
          <label key={k} className="flex items-center gap-1 capitalize">
            <input
              type="checkbox"
              checked={kinds.includes(k)}
              onChange={(e) =>
                setKinds((ks) => (e.target.checked ? [...ks, k] : ks.filter((x) => x !== k)))
              }
            />
            <span className={`rounded px-1.5 text-xs ${KIND_COLORS[k]}`}>{k}</span>
          </label>
        ))}
      </div>

      {reminders.length > 0 && (
        <section aria-label="Upcoming reminders" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950">
          <h2 className="font-semibold">Reminders (next 30 days)</h2>
          <ul className="mt-1 flex flex-col gap-1">
            {reminders.map((r) => (
              <li key={r.goal_id} className="flex items-center gap-2">
                <span className="flex-1 truncate">{r.goal_title}</span>
                <span className="text-xs">{new Date(r.reminder_at).toLocaleString()}</span>
                <Link to={`/goals?open=${r.goal_id}`} className="text-xs underline">
                  Open goal
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold text-slate-500" aria-hidden>
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <div key={d}>{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1" role="grid" aria-label={monthName}>
        {cells.map((day) => {
          const inMonth = day.startsWith(
            `${cursor.year}-${String(cursor.month + 1).padStart(2, "0")}`,
          );
          const dayEvents = byDay.get(day) ?? [];
          const isToday = day === isoDay(new Date());
          return (
            <button
              key={day}
              role="gridcell"
              aria-label={`${day}, ${dayEvents.length} events`}
              onClick={() => setSelectedDay(day)}
              className={`flex min-h-16 flex-col gap-0.5 rounded-lg border p-1 text-left ${
                selectedDay === day
                  ? "border-slate-500"
                  : "border-slate-200 dark:border-slate-800"
              } ${inMonth ? "" : "opacity-40"} ${isToday ? "bg-blue-50 dark:bg-blue-950" : ""}`}
            >
              <span className="text-xs font-medium">{Number(day.slice(8))}</span>
              {dayEvents.slice(0, 3).map((e) => (
                <span
                  key={e.id}
                  className={`truncate rounded px-1 text-[10px] ${KIND_COLORS[e.kind] ?? "bg-slate-100"}`}
                  title={e.title}
                >
                  {e.title}
                </span>
              ))}
              {dayEvents.length > 3 && (
                <span className="text-[10px] text-slate-500">+{dayEvents.length - 3} more</span>
              )}
            </button>
          );
        })}
      </div>

      <section aria-label="Day agenda" className="rounded-xl border border-slate-200 p-3 dark:border-slate-800">
        <h2 className="font-semibold">
          {selectedDay ? `Agenda — ${selectedDay}` : "Select a day to see its agenda"}
        </h2>
        {selectedDay && agenda.length === 0 && (
          <p className="mt-1 text-sm text-slate-500">Nothing scheduled this day.</p>
        )}
        <ul className="mt-2 flex flex-col gap-1 text-sm">
          {agenda.map((e) => (
            <li key={e.id} className="flex items-center gap-2">
              <span className={`rounded px-1.5 text-xs capitalize ${KIND_COLORS[e.kind] ?? ""}`}>
                {e.kind}
              </span>
              <span className="flex-1 truncate font-medium">{e.title}</span>
              {e.datetime && (
                <span className="text-xs text-slate-500">
                  {new Date(e.datetime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              )}
              {eventLink(e) && (
                <Link to={eventLink(e) as string} className="text-xs underline">
                  Open goal
                </Link>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
