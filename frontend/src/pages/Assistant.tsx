import { useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { Bot, Lightbulb, Send } from "lucide-react";
import { ApiError, askAssistant } from "../lib/api";
import type { AssistantOut } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Button, EmptyState, PageHeader, Spinner } from "../components/ui";

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

  if (loading) return <Spinner />;
  if (!user) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="AI Assistant" sub="Sign in to get recommendations from your records." />
        <EmptyState
          title="You're signed out"
          action={<Link to="/login" className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white">Sign in</Link>}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <PageHeader
        title="AI Assistant"
        sub="Grounded in your goals, tasks, files, and activity. Facts are records; suggestions are labeled advice."
      />

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </div>
      )}

      {messages.length === 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-card dark:border-slate-800 dark:bg-slate-900">
          <p className="mb-2.5 flex items-center gap-1.5 text-sm font-semibold">
            <Bot size={16} className="text-indigo-500" aria-hidden /> Try asking
          </p>
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLES.map((ex) => (
              <button
                key={ex}
                onClick={() => void send(ex)}
                className="rounded-full border border-slate-200 px-3 py-1.5 text-[13px] transition-colors hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 dark:border-slate-700 dark:hover:border-indigo-700 dark:hover:bg-indigo-950 dark:hover:text-indigo-200"
              >
                {ex}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3" aria-live="polite">
        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="fm-fade max-w-[85%] self-end rounded-2xl rounded-br-md bg-indigo-600 px-3.5 py-2 text-sm text-white">
              {m.text}
            </div>
          ) : (
            <div
              key={i}
              className="fm-fade max-w-[95%] self-start rounded-2xl rounded-bl-md border border-slate-200 bg-white p-3.5 text-sm shadow-card dark:border-slate-800 dark:bg-slate-900"
            >
              <p className="whitespace-pre-wrap leading-relaxed">{m.reply?.answer}</p>
              {m.reply && m.reply.facts.length > 0 && (
                <details className="mt-2.5 rounded-lg bg-slate-50 px-2.5 py-2 dark:bg-slate-800/60">
                  <summary className="cursor-pointer text-xs font-medium text-slate-500">
                    Facts used ({m.reply.facts.length})
                  </summary>
                  <ul className="mt-1.5 flex flex-col gap-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                    {m.reply.facts.map((f, j) => (
                      <li key={j}>· {f}</li>
                    ))}
                  </ul>
                </details>
              )}
              {m.reply && m.reply.suggestions.length > 0 && (
                <p className="mt-2 flex gap-1.5 rounded-lg bg-amber-50 p-2.5 text-xs leading-relaxed text-amber-900 dark:bg-amber-950 dark:text-amber-100">
                  <Lightbulb size={14} className="mt-0.5 shrink-0" aria-hidden />
                  <span><strong>Suggestion:</strong> {m.reply.suggestions.join(" ")}</span>
                </p>
              )}
              <p className="fm-num mt-1.5 text-[11px] text-slate-400">
                {m.reply?.intent} · {m.reply?.source}
              </p>
            </div>
          ),
        )}
        {busy && (
          <p className="flex items-center gap-2 text-sm text-slate-400" role="status">
            <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-600" aria-hidden />
            Thinking…
          </p>
        )}
      </div>

      <form onSubmit={onSubmit} className="sticky bottom-3 flex gap-2 rounded-xl border border-slate-200 bg-white p-1.5 shadow-pop dark:border-slate-700 dark:bg-slate-900">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about your work…"
          aria-label="Ask the assistant"
          className="min-w-0 flex-1 rounded-lg bg-transparent px-2.5 py-2 text-sm placeholder:text-slate-400"
        />
        <Button type="submit" variant="primary" disabled={busy} aria-label="Send message">
          <Send size={15} />
        </Button>
      </form>
    </div>
  );
}
