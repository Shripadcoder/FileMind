import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ApiError,
  aiStatus,
  getAISettings,
  updateAISettings,
} from "../lib/api";
import type { AISettings, AIStatus } from "../lib/api";
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
    </div>
  );
}
