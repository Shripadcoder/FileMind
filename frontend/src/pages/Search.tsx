import { useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { FileText, MessageCircleQuestion, Search as SearchIcon } from "lucide-react";
import { ApiError, askDocs, semanticSearch } from "../lib/api";
import type { AskOut, SemanticHit } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Badge, Button, EmptyState, PageHeader, Spinner, cardCls, inputCls } from "../components/ui";

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

  if (loading) return <Spinner />;
  if (!user) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="Smart Search" sub="Sign in to search your documents." />
        <EmptyState
          title="You're signed out"
          action={<Link to="/login" className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white">Sign in</Link>}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHeader
        title="Smart Search"
        sub={`Meaning-based search over your extracted documents — computed locally${engine ? ` · engine: ${engine}` : ""}.`}
      />

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
          {error}
        </div>
      )}

      <section aria-label="Semantic search" className="flex flex-col gap-3">
        <form onSubmit={(e) => void runSearch(e)} className="relative">
          <SearchIcon size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Describe what you're looking for…"
            aria-label="Semantic search query"
            className={`${inputCls} w-full py-2.5 pl-10 pr-24 !rounded-xl shadow-card`}
          />
          <Button type="submit" variant="primary" disabled={busy} className="absolute right-1.5 top-1/2 -translate-y-1/2">
            {busy ? "Searching…" : "Search"}
          </Button>
        </form>

        {searched && hits.length === 0 && (
          <EmptyState
            title="No relevant documents"
            hint="Try different wording, or upload and extract more files first."
          />
        )}
        {hits.length > 0 && (
          <ol className="flex flex-col gap-2">
            {hits.map((h, i) => (
              <li key={h.file_id} className={`${cardCls} fm-fade flex gap-3 p-3.5 transition-shadow hover:shadow-pop`}>
                <span className="fm-num flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-100 text-xs font-bold text-slate-500 dark:bg-slate-800" aria-hidden>
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link to={`/files?open=${h.file_id}`} className="min-w-0 flex-1 truncate text-sm font-semibold hover:text-indigo-600 dark:hover:text-indigo-300">
                      {h.filename}
                    </Link>
                    {h.category_name && <Badge tone="slate">{h.category_name}</Badge>}
                    <Badge tone="violet">score {h.score.toFixed(3)}</Badge>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-slate-500 dark:text-slate-400">…{h.snippet}…</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section aria-label="Ask your documents" className={`${cardCls} fm-fade p-4 md:p-5`}>
        <h2 className="flex items-center gap-2 text-[15px] font-bold tracking-tight">
          <MessageCircleQuestion size={17} className="text-indigo-500" aria-hidden />
          Ask your documents
        </h2>
        <p className="mt-1 text-[13px] text-slate-500">
          Answers quote your files verbatim with source references. Anything the documents
          don&apos;t contain gets an honest &ldquo;not found&rdquo; — never an invention.
        </p>
        <form onSubmit={(e) => void runAsk(e)} className="mt-3 flex gap-2">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g. What optimizes model weights?"
            aria-label="Question about your documents"
            className={`${inputCls} min-w-0 flex-1 py-2`}
          />
          <Button type="submit" variant="primary" disabled={busy}>Ask</Button>
        </form>
        {answer && (
          <div className="mt-3 rounded-xl bg-slate-50 p-3.5 text-sm dark:bg-slate-800/60">
            <p className="whitespace-pre-wrap leading-relaxed">{answer.answer}</p>
            {answer.citations.length > 0 && (
              <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
                {answer.citations.map((c, i) => (
                  <Link
                    key={`${c.file_id}-${c.chunk}-${i}`}
                    to={`/files?open=${c.file_id}`}
                    className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs transition-shadow hover:shadow-card dark:border-slate-700 dark:bg-slate-900"
                  >
                    <FileText size={14} className="shrink-0 text-indigo-500" aria-hidden />
                    <span className="min-w-0 flex-1 truncate font-medium">{c.filename}</span>
                    {c.page ? <span className="shrink-0 text-slate-400">p. {c.page}</span> : null}
                  </Link>
                ))}
              </div>
            )}
            <p className="mt-2 text-[11px] text-slate-400">source: {answer.source}</p>
          </div>
        )}
      </section>
    </div>
  );
}
