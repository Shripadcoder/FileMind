import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Folders } from "lucide-react";
import { useAuth } from "../lib/auth";
import { ApiError } from "../lib/api";
import { Button, inputCls } from "../components/ui";

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
    <div className="mx-auto flex w-full max-w-sm flex-col gap-5 py-6">
      <div className="flex flex-col items-center gap-2 text-center">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-card">
          <Folders size={22} aria-hidden />
        </span>
        <h1 className="text-xl font-bold tracking-tight">
          {mode === "login" ? "Welcome back" : "Create your account"}
        </h1>
        <p className="-mt-3 text-sm text-slate-500">
          {mode === "login"
            ? "Your files, goals, and activity are private to your account."
            : "Passwords are hashed with bcrypt; sessions use short-lived JWTs."}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-1 rounded-xl border border-slate-200 bg-slate-100 p-1 dark:border-slate-800 dark:bg-slate-900" role="tablist" aria-label="Authentication mode">
        {(["login", "register"] as const).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={mode === m}
            onClick={() => {
              setMode(m);
              setError(null);
            }}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              mode === m
                ? "bg-white text-slate-900 shadow-card dark:bg-slate-700 dark:text-white"
                : "text-slate-500 hover:text-slate-800 dark:text-slate-400"
            }`}
          >
            {m === "login" ? "Sign in" : "Register"}
          </button>
        ))}
      </div>

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </div>
      )}

      <form onSubmit={onSubmit} className="rounded-xl border border-slate-200 bg-white p-4 shadow-card dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-col gap-2.5">
          {mode === "register" && (
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs text-slate-400">Display name</span>
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoComplete="name" className={inputCls} />
            </label>
          )}
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs text-slate-400">Email</span>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" className={inputCls} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs text-slate-400">Password{mode === "register" ? " (min 8 characters)" : ""}</span>
            <input
              type="password"
              required
              minLength={mode === "register" ? 8 : 1}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              className={inputCls}
            />
          </label>
          <Button type="submit" variant="primary" disabled={busy} className="justify-center !py-2">
            {busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
          </Button>
        </div>
      </form>

      <p className="text-center text-sm text-slate-400">
        <Link to="/" className="hover:underline">Back to dashboard</Link>
      </p>
    </div>
  );
}
