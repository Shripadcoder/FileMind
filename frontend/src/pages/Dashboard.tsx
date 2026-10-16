import { useEffect, useState } from "react";
import { getHealth, getReady } from "../lib/api";

export default function Dashboard() {
  const [health, setHealth] = useState<string>("checking…");
  const [ready, setReady] = useState<string>("checking…");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const h = await getHealth();
        setHealth(h.status);
        const r = await getReady();
        setReady(`${r.status}${r.database ? ` · db ${r.database}` : ""}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "backend unreachable");
        setHealth("unreachable");
        setReady("unknown");
      }
    })();
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-sm text-slate-500">
          Phase 1 foundation. Metrics will be computed from real database records starting in Phase 3 — no demo
          numbers are shown.
        </p>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
          Backend unreachable ({error}). Start it with <code>uvicorn app.main:app --reload</code> from{" "}
          <code>backend/</code>.
        </div>
      )}

      <section aria-label="System status" className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-500">API HEALTH</h2>
          <p className="mt-1 text-lg font-bold">{health}</p>
        </div>
        <div className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
          <h2 className="text-sm font-semibold text-slate-500">READINESS</h2>
          <p className="mt-1 text-lg font-bold">{ready}</p>
        </div>
      </section>

      <section aria-label="Productivity overview" className="rounded-xl border border-slate-200 p-4 dark:border-slate-800">
        <h2 className="font-semibold">Productivity overview</h2>
        <p className="mt-1 text-sm text-slate-500">
          Empty state: no goals, files, or activity records exist yet. This section will render live counts (active /
          completed / overdue) once the Phase 3 goal system lands.
        </p>
      </section>
    </div>
  );
}
