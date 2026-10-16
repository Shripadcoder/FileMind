import { useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { ApiError, askDocs, semanticSearch } from "../lib/api";
import type { AskOut, SemanticHit } from "../lib/api";
import { useAuth } from "../lib/auth";

function errMsg(e: unknown): string {
  return e instanceof ApiError ? e.message : "Something went wrong";
}

export default function Search() {
  const { user, loading } = useAuth();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SemanticHit[]>([]);
  const [engine, setEngine] = useState("");
  const [searched, setSearched] = useState(false);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<AskOut | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runSearch(e: FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await semanticSearch(query.trim());
      setHits(res.hits);
      setEngine(res.engine);
      setSearched(true);
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  async function runAsk(e: FormEvent) {
    e.preventDefault();
    if (!question.trim()) return;
    setBusy(true);
    setError(null);
    try {
      setAnswer(await askDocs(question.trim()));
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="text-sm text-slate-500">Loading…</p>;
  if (!user) {
    return (
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold">Smart Search</h1>
        <p className="text-sm text-slate-500">
          Sign in to search your documents.{" "}
          <Link to="/login" className="underline">
            Go to sign in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Smart Search</h1>
        <p className="text-sm text-slate-500">
          Meaning-based search over your extracted documents — runs locally on this server
          {engine ? ` (engine: ${engine})` : ""}. No data leaves the machine.
        </p>
      </div>

      {error && (
        <div role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <section aria-label="Semantic search" className="flex flex-col gap-2">
        <form onSubmit={(e) => void runSearch(e)} className="flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Describe what you're looking for…"
            aria-label="Semantic search query"
            className="flex-1 rounded-lg border border-slate-200 bg-transparent px-3 py-2 text-sm dark:border-slate-700"
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
          >
            {busy ? "Searching…" : "Search"}
          </button>
        </form>

        {searched && hits.length === 0 && (
          <p className="text-sm text-slate-500">
            No relevant documents. Try different wording, or upload and extract more files first.
          </p>
        )}
        {hits.length > 0 && (
          <ul className="flex flex-col gap-2">
            {hits.map((h) => (
              <li
                key={h.file_id}
                className="rounded-xl border border-slate-200 p-3 dark:border-slate-800"
              >
                <div className="flex items-center gap-2 text-sm">
                  <Link
                    to={`/files?open=${h.file_id}`}
                    className="flex-1 truncate font-medium hover:underline"
                  >
                    {h.filename}
                  </Link>
                  {h.category_name && (
                    <span className="text-xs text-slate-500">{h.category_name}</span>
                  )}
                  <span className="rounded bg-slate-100 px-1.5 text-xs dark:bg-slate-800">
                    score {h.score.toFixed(3)}
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-500">…{h.snippet}…</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section
        aria-label="Ask your documents"
        className="flex flex-col gap-2 rounded-xl border border-slate-200 p-4 dark:border-slate-800"
      >
        <h2 className="font-semibold">Ask your documents</h2>
        <p className="text-xs text-slate-500">
          Answers quote your files verbatim with file{answer?.citations.some((c) => c.page) ? " and page" : ""} references.
          Anything the documents don&apos;t contain gets an honest &ldquo;not found&rdquo; — never an invention.
        </p>
        <form onSubmit={(e) => void runAsk(e)} className="flex gap-2">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g. What optimizes model weights?"
            aria-label="Question about your documents"
            className="flex-1 rounded-lg border border-slate-200 bg-transparent px-3 py-2 text-sm dark:border-slate-700"
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
          >
            {busy ? "Thinking…" : "Ask"}
          </button>
        </form>
        {answer && (
          <div className="rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-900">
            <p className="whitespace-pre-wrap">{answer.answer}</p>
            {answer.citations.length > 0 && (
              <ul className="mt-2 flex flex-col gap-1 text-xs text-slate-500">
                {answer.citations.map((c, i) => (
                  <li key={`${c.file_id}-${c.chunk}-${i}`}>
                    [{i + 1}]{" "}
                    <Link to={`/files?open=${c.file_id}`} className="underline">
                      {c.filename}
                    </Link>
                    {c.page ? `, page ${c.page}` : ""} (relevance {c.score.toFixed(3)})
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-xs text-slate-400">source: {answer.source}</p>
          </div>
        )}
      </section>
    </div>
  );
}
