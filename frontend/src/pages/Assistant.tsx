import { useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { Bot } from "lucide-react";
import { ApiError, askAssistant } from "../lib/api";
import type { AssistantOut } from "../lib/api";
import { useAuth } from "../lib/auth";

const EXAMPLES = [
  "What should I work on today?",
  "Am I on track with my goals?",
  "Which goals have made the least progress?",
  "Summarize my productivity this week.",
  "Which tasks should I prioritize?",
];

interface Message {
  role: "user" | "assistant";
  text?: string;
  reply?: AssistantOut;
}

function errMsg(e: unknown): string {
  return e instanceof ApiError ? e.message : "Something went wrong";
}

export default function Assistant() {
  const { user, loading } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    setBusy(true);
    setError(null);
    setMessages((m) => [...m, { role: "user", text: q }]);
    setInput("");
    try {
      const reply = await askAssistant(q);
      setMessages((m) => [...m, { role: "assistant", reply }]);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void send(input);
  }

  if (loading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (!user) {
    return (
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">AI Assistant</h1>
        <p className="text-sm text-slate-500">
          Sign in to get recommendations from your records.{" "}
          <Link to="/login" className="underline">
            Go to sign in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Bot size={22} /> AI Assistant
        </h1>
        <p className="text-sm text-slate-500">
          Answers come from your real goals, tasks, files, and activity.{" "}
          <strong>Facts</strong> are database records; <strong>suggestions</strong> are labeled advice.
        </p>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {messages.length === 0 && (
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              onClick={() => void send(ex)}
              className="rounded-full border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
            >
              {ex}
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-3" aria-live="polite">
        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="self-end rounded-xl bg-slate-900 px-3 py-2 text-sm text-white dark:bg-slate-100 dark:text-slate-900">
              {m.text}
            </div>
          ) : (
            <div
              key={i}
              className="rounded-xl border border-slate-200 p-3 text-sm dark:border-slate-800"
            >
              <p className="whitespace-pre-wrap">{m.reply?.answer}</p>
              {m.reply && m.reply.facts.length > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-slate-500">
                    Facts used ({m.reply.facts.length})
                  </summary>
                  <ul className="mt-1 flex flex-col gap-0.5 text-xs text-slate-500">
                    {m.reply.facts.map((f, j) => (
                      <li key={j}>· {f}</li>
                    ))}
                  </ul>
                </details>
              )}
              {m.reply && m.reply.suggestions.length > 0 && (
                <p className="mt-2 rounded bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-100">
                  Suggestion: {m.reply.suggestions.join(" ")}
                </p>
              )}
              <p className="mt-1 text-xs text-slate-400">
                intent: {m.reply?.intent} · {m.reply?.source}
              </p>
            </div>
          ),
        )}
        {busy && <p className="text-sm text-slate-500">Thinking…</p>}
      </div>

      <form onSubmit={onSubmit} className="flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about your work…"
          aria-label="Ask the assistant"
          className="flex-1 rounded-lg border border-slate-200 bg-transparent px-3 py-2 text-sm dark:border-slate-700"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
        >
          Send
        </button>
      </form>
    </div>
  );
}
