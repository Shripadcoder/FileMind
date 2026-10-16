import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
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

function errMsg(e: unknown): string {
  return e instanceof ApiError ? e.message : "Something went wrong";
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

  if (loading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (!user) {
    return (
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-slate-500">
          <Link to="/login" className="underline">
            Sign in
          </Link>{" "}
          to manage settings.
        </p>
      </div>
    );
  }

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <h1 className="text-2xl font-bold">Settings</h1>

      {error && (
        <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}
      {saved && (
        <div role="status" className="rounded-lg border border-green-300 bg-green-50 p-3 text-sm text-green-900">
          Preference saved.
        </div>
      )}

      <section
        aria-label="Account"
        className="rounded-xl border border-slate-200 p-4 dark:border-slate-800"
      >
        <h2 className="font-semibold">Account</h2>
        <p className="mt-1 text-sm text-slate-500">
          {user.display_name ? `${user.display_name} · ` : ""}
          {user.email}
        </p>
        <button
          onClick={logout}
          className="mt-2 rounded-lg border border-slate-200 px-3 py-1.5 text-sm dark:border-slate-700"
        >
          Sign out
        </button>
      </section>

      <section
        aria-label="AI processing"
        className="rounded-xl border border-slate-200 p-4 dark:border-slate-800"
      >
        <h2 className="font-semibold">AI processing</h2>
        <p className="mt-1 text-sm text-slate-500">
          Extraction, summaries, semantic search, and suggestions run{" "}
          <strong>locally on this server</strong> — your documents never leave the machine.
        </p>
        {status && (
          <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
            <div>
              <dt className="text-slate-500">Local engine</dt>
              <dd className="font-mono text-xs">{status.local_engine}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Extraction supports</dt>
              <dd className="font-mono text-xs">{status.extraction_methods.join(", ")}</dd>
            </div>
            <div>
              <dt className="text-slate-500">External AI globally</dt>
              <dd>{status.ai_processing_enabled ? "enabled" : "disabled"}</dd>
            </div>
            <div>
              <dt className="text-slate-500">External provider configured</dt>
              <dd>{status.provider_configured ? "yes" : "no"}</dd>
            </div>
          </dl>
        )}
        {!prefs?.ai_processing_enabled && (
          <p className="mt-2 text-xs text-slate-500">
            External processing is currently disabled server-wide (`AI_PROCESSING_ENABLED=false`).
            The toggle below takes effect only if an administrator enables it and configures a provider.
          </p>
        )}
        <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
          <input
            type="checkbox"
            checked={prefs?.ai_consent_external ?? false}
            onChange={(e) => void toggleConsent(e.target.checked)}
            className="mt-1"
          />
          <span className="text-sm">
            <strong>Allow external AI processing of my documents.</strong>
            <br />
            <span className="text-slate-500">
              If enabled (and only then), document text and activity records may be sent to the
              configured external AI provider for answers and suggestions. You can revoke this at
              any time; revocation is immediate and local features keep working regardless.
            </span>
          </span>
        </label>
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
    <section
      aria-label="Integrations"
      className="rounded-xl border border-slate-200 p-4 dark:border-slate-800"
    >
      <h2 className="font-semibold">Integrations</h2>
      {error && (
        <div role="alert" className="mt-2 rounded-lg border border-red-300 bg-red-50 p-2 text-sm text-red-800">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="mt-2 rounded-lg border border-green-300 bg-green-50 p-2 text-sm text-green-900">
          {notice}
        </div>
      )}
      <ul className="mt-2 flex flex-col gap-1 text-sm">
        {providers.map((p) => (
          <li key={p.key} className="flex items-start gap-2">
            <span
              className={`mt-0.5 rounded px-1.5 text-xs ${p.available ? "bg-green-100 text-green-800" : "bg-slate-100 text-slate-500"}`}
            >
              {p.available ? "available" : "unavailable"}
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
          className="flex-1 rounded-lg border border-slate-200 bg-transparent px-2 py-1.5 text-sm dark:border-slate-700"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-slate-700"
        >
          {busy ? "Looking up…" : "List repos"}
        </button>
      </form>

      {repos.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1 text-sm">
          {repos.map((r) => (
            <li
              key={`${r.owner}/${r.name}`}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 px-2 py-1.5 dark:border-slate-800"
            >
              <a
                href={r.html_url}
                target="_blank"
                rel="noreferrer"
                className="flex-1 truncate font-medium underline"
              >
                {r.owner}/{r.name}
              </a>
              {r.language && <span className="text-xs text-slate-500">{r.language}</span>}
              <span className="text-xs text-slate-500">★ {r.stars}</span>
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
                className="text-xs underline"
              >
                Import as goal
              </button>
              <button
                onClick={() =>
                  githubLogActivity(username.trim(), r.name, logGoal ? Number(logGoal) : null)
                    .then((a) => setNotice(`Logged: ${a.title}`))
                    .catch((err) => setError(errMsg(err)))
                }
                className="text-xs underline"
              >
                Log latest commit
              </button>
            </li>
          ))}
        </ul>
      )}
      {repos.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <label className="flex items-center gap-1 text-xs text-slate-500">
            Goal category for imports
            <input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="e.g. Build"
              className="w-28 rounded border border-slate-200 bg-transparent px-1 py-1 dark:border-slate-700"
            />
          </label>
          <label className="flex items-center gap-1 text-xs text-slate-500">
            Attach commits to goal
            <select
              value={logGoal}
              onChange={(e) => setLogGoal(e.target.value)}
              className="max-w-40 rounded border border-slate-200 bg-transparent px-1 py-1 dark:border-slate-700"
            >
              <option value="">None</option>
              {goals.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.title}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
    </section>
  );
}
