import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { Cpu, Plug2, ShieldCheck, User as UserIcon } from "lucide-react";
import {
  ApiError,
  aiStatus,
  getAISettings,
  githubImport,
  githubLogActivity,
  githubRepos,
  integrationsStatus,
  listGoals,
  updateAISettings,
} from "../lib/api";
import type { AISettings, AIStatus, GitHubRepo, GoalItem, ProviderStatus } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Button, EmptyState, PageHeader, Spinner, cardCls, inputCls } from "../components/ui";

function errMsg(e: unknown): string {
  return e instanceof ApiError ? e.message : "Something went wrong";
}

function StatusRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800/60">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  );
}

export default function Settings() {
  const { user, loading, logout } = useAuth();
  const [status, setStatus] = useState<AIStatus | null>(null);
  const [prefs, setPrefs] = useState<AISettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!user) return;
    Promise.all([aiStatus(), getAISettings()])
      .then(([s, p]) => {
        setStatus(s);
        setPrefs(p);
      })
      .catch((e) => setError(errMsg(e)));
  }, [user]);

  async function toggleConsent(allowed: boolean) {
    setError(null);
    setSaved(false);
    try {
      setPrefs(await updateAISettings(allowed));
      setStatus(await aiStatus());
      setSaved(true);
    } catch (e) {
      setError(errMsg(e));
    }
  }

  if (loading) return <Spinner />;
  if (!user) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Settings" />
        <EmptyState
          title="You're signed out"
          action={<Link to="/login" className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white">Sign in</Link>}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <PageHeader title="Settings" sub="Account, privacy, AI processing, and integrations." />

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </div>
      )}
      {saved && (
        <div role="status" className="rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-900 dark:border-green-900 dark:bg-green-950 dark:text-green-200">
          Preference saved.
        </div>
      )}

      <section aria-label="Account" className={`${cardCls} p-4 md:p-5`}>
        <h2 className="flex items-center gap-1.5 text-[15px] font-bold tracking-tight">
          <UserIcon size={16} className="text-indigo-500" aria-hidden /> Account
        </h2>
        <div className="mt-3 flex items-center gap-3">
          <span aria-hidden className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-100 text-sm font-bold text-indigo-700 dark:bg-indigo-950 dark:text-indigo-200">
            {(user.display_name || user.email).slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{user.display_name || user.email}</p>
            <p className="truncate text-xs text-slate-400">{user.email}</p>
          </div>
          <Button variant="secondary" onClick={logout}>Sign out</Button>
        </div>
      </section>

      <section aria-label="AI processing and privacy" className={`${cardCls} p-4 md:p-5`}>
        <h2 className="flex items-center gap-1.5 text-[15px] font-bold tracking-tight">
          <ShieldCheck size={16} className="text-green-600" aria-hidden /> AI processing & privacy
        </h2>
        <p className="mt-1 text-[13px] leading-relaxed text-slate-500">
          Extraction, summaries, semantic search, and suggestions run{" "}
          <strong className="text-slate-700 dark:text-slate-200">locally on this server</strong> — your
          documents never leave the machine for those features.
        </p>
        {status && (
          <dl className="mt-3 grid gap-1.5 sm:grid-cols-2">
            <StatusRow label="Local engine">
              <span className="font-mono text-xs">{status.local_engine}</span>
            </StatusRow>
            <StatusRow label="Extracts">
              <span className="font-mono text-xs">{status.extraction_methods.join(", ")}</span>
            </StatusRow>
            <StatusRow label="External AI globally">
              <span className={status.ai_processing_enabled ? "text-amber-600" : "text-green-600"}>
                {status.ai_processing_enabled ? "Enabled" : "Disabled"}
              </span>
            </StatusRow>
            <StatusRow label="Provider configured">
              {status.provider_configured ? "Yes" : "No"}
            </StatusRow>
          </dl>
        )}
        {!prefs?.ai_processing_enabled && (
          <p className="mt-2 text-xs leading-relaxed text-slate-400">
            External processing is disabled server-wide (`AI_PROCESSING_ENABLED=false`). The toggle
            below takes effect only if an administrator enables it and configures a provider.
          </p>
        )}
        <button
          role="switch"
          aria-checked={prefs?.ai_consent_external ?? false}
          onClick={() => void toggleConsent(!(prefs?.ai_consent_external ?? false))}
          className="mt-3 flex w-full cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3.5 text-left transition-colors hover:border-indigo-300 dark:border-slate-700 dark:hover:border-indigo-700"
        >
          <span
            aria-hidden
            className={`mt-0.5 flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors ${
              prefs?.ai_consent_external ? "justify-end bg-indigo-600" : "justify-start bg-slate-300 dark:bg-slate-700"
            }`}
          >
            <span className="h-5 w-5 rounded-full bg-white shadow" />
          </span>
          <span className="text-sm">
            <strong>Allow external AI processing of my documents</strong>
            <br />
            <span className="text-slate-500">
              If enabled (and only then), document text and activity records may be sent to the
              configured external AI provider. Revocation is immediate; local features keep working
              regardless.
            </span>
          </span>
        </button>
      </section>

      <section aria-label="AI provider status" className={`${cardCls} p-4 md:p-5`}>
        <h2 className="flex items-center gap-1.5 text-[15px] font-bold tracking-tight">
          <Cpu size={16} className="text-indigo-500" aria-hidden /> Provider status
        </h2>
        <dl className="mt-3 grid gap-1.5">
          <StatusRow label="Embedding model">
            <span className="font-mono text-xs">{status?.embedding_model ?? "…"}</span>
          </StatusRow>
          <StatusRow label="Chat model">
            <span className="font-mono text-xs">{status?.llm_model ?? "…"}</span>
          </StatusRow>
          <StatusRow label="External calls for you">
            <span className={status?.external_allowed_for_user ? "text-amber-600" : "text-green-600"}>
              {status ? (status.external_allowed_for_user ? "Allowed" : "Blocked") : "…"}
            </span>
          </StatusRow>
        </dl>
        <p className="mt-2 text-xs text-slate-400">
          External calls happen only when the global switch, provider configuration, and your
          consent above all agree. Anything less falls back to local engines.
        </p>
      </section>

      <Integrations />
    </div>
  );
}

function Integrations() {
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [username, setUsername] = useState("");
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [goals, setGoals] = useState<GoalItem[]>([]);
  const [logGoal, setLogGoal] = useState("");
  const [category, setCategory] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    integrationsStatus()
      .then((s) => setProviders(s.providers))
      .catch((e) => setError(errMsg(e)));
    listGoals({ limit: 200 })
      .then(setGoals)
      .catch(() => undefined);
  }, []);

  async function lookup(e: FormEvent) {
    e.preventDefault();
    if (!username.trim()) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setRepos(await githubRepos(username.trim()));
    } catch (err) {
      setError(errMsg(err));
      setRepos([]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Integrations" className={`${cardCls} p-4 md:p-5`}>
      <h2 className="flex items-center gap-1.5 text-[15px] font-bold tracking-tight">
        <Plug2 size={16} className="text-indigo-500" aria-hidden /> Integrations
      </h2>
      {error && (
        <div role="alert" className="mt-2 rounded-lg border border-red-200 bg-red-50 p-2.5 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="mt-2 rounded-lg border border-green-200 bg-green-50 p-2.5 text-sm text-green-900 dark:border-green-900 dark:bg-green-950 dark:text-green-200">
          {notice}
        </div>
      )}
      <ul className="mt-3 flex flex-col gap-2">
        {providers.map((p) => (
          <li key={p.key} className="flex items-start gap-2.5 rounded-lg bg-slate-50 p-2.5 text-sm dark:bg-slate-800/60">
            <span className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold ${p.available ? "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300" : "bg-slate-200 text-slate-500 dark:bg-slate-700"}`}>
              {p.available ? "Available" : "Unavailable"}
            </span>
            <span>
              <strong>{p.label}.</strong> <span className="text-slate-500">{p.note}</span>
            </span>
          </li>
        ))}
      </ul>

      <form onSubmit={(e) => void lookup(e)} className="mt-3 flex gap-2">
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="GitHub username"
          aria-label="GitHub username"
          className={`${inputCls} min-w-0 flex-1`}
        />
        <Button type="submit" disabled={busy}>{busy ? "Looking up…" : "List repos"}</Button>
      </form>

      {repos.length > 0 && (
        <>
          <ul className="mt-2.5 flex flex-col gap-1.5">
            {repos.map((r) => (
              <li
                key={`${r.owner}/${r.name}`}
                className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-slate-200 px-2.5 py-2 text-sm dark:border-slate-800"
              >
                <a href={r.html_url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate font-semibold text-indigo-600 hover:underline dark:text-indigo-300">
                  {r.owner}/{r.name}
                </a>
                {r.language && <span className="text-xs text-slate-400">{r.language}</span>}
                <span className="fm-num text-xs text-slate-400">★ {r.stars}</span>
                <button
                  onClick={() =>
                    githubImport(username.trim(), r.name, category.trim())
                      .then((g) => {
                        setNotice(`Imported “${g.title}” as a project goal.`);
                        return listGoals({ limit: 200 });
                      })
                      .then(setGoals)
                      .catch((err) => setError(errMsg(err)))
                  }
                  className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-300"
                >
                  Import as goal
                </button>
                <button
                  onClick={() =>
                    githubLogActivity(username.trim(), r.name, logGoal ? Number(logGoal) : null)
                      .then((a) => setNotice(`Logged: ${a.title}`))
                      .catch((err) => setError(errMsg(err)))
                  }
                  className="text-xs text-slate-500 hover:underline"
                >
                  Log latest commit
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-2.5 flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 p-2.5 text-xs text-slate-500 dark:bg-slate-800/60">
            <label className="flex items-center gap-1.5">
              Goal category for imports
              <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. Build" className={`${inputCls} w-28 !py-1`} />
            </label>
            <label className="flex items-center gap-1.5">
              Attach commits to goal
              <select value={logGoal} onChange={(e) => setLogGoal(e.target.value)} className={`${inputCls} max-w-40 !py-1`}>
                <option value="">None</option>
                {goals.map((g) => (
                  <option key={g.id} value={g.id}>{g.title}</option>
                ))}
              </select>
            </label>
          </div>
        </>
      )}
    </section>
  );
}
