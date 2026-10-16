import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { ApiError } from "../lib/api";

export default function Login() {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "login") {
        await login(email.trim(), password);
      } else {
        await register(email.trim(), password, displayName.trim());
      }
      navigate("/files");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-md flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold">{mode === "login" ? "Sign in" : "Create account"}</h1>
        <p className="text-sm text-slate-500">
          File libraries are private to each account. Passwords are hashed with bcrypt; sessions use
          short-lived JWTs.
        </p>
      </div>

      <div className="flex gap-2" role="tablist" aria-label="Authentication mode">
        {(["login", "register"] as const).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={mode === m}
            onClick={() => {
              setMode(m);
              setError(null);
            }}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              mode === m
                ? "bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"
                : "border border-slate-200 dark:border-slate-700"
            }`}
          >
            {m === "login" ? "Sign in" : "Register"}
          </button>
        ))}
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        {mode === "register" && (
          <label className="flex flex-col gap-1 text-sm">
            Display name
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="rounded-lg border border-slate-200 bg-transparent px-3 py-2 dark:border-slate-700"
              autoComplete="name"
            />
          </label>
        )}
        <label className="flex flex-col gap-1 text-sm">
          Email
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-lg border border-slate-200 bg-transparent px-3 py-2 dark:border-slate-700"
            autoComplete="email"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Password{mode === "register" ? " (min 8 characters)" : ""}
          <input
            type="password"
            required
            minLength={mode === "register" ? 8 : 1}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-lg border border-slate-200 bg-transparent px-3 py-2 dark:border-slate-700"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
        >
          {busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
        </button>
      </form>

      <p className="text-sm text-slate-500">
        <Link to="/" className="underline">
          Back to dashboard
        </Link>
      </p>
    </div>
  );
}
