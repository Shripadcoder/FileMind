"""Source-grounded document question answering.

Local engine (default): retrieval over the user's chunks with TF-IDF, then an
extractive answer composed of verbatim quoted passages plus file/page
citations. Because every claim is a direct quote with a pointer, the answer
cannot invent document contents. When nothing relevant scores above the
threshold, it says so honestly instead of answering from nothing.

External LLM path: used only with double consent; retrieved text is wrapped
as untrusted data and the model is instructed to cite sources."""

import numpy as np

from app.services.ai.chunking import Chunk
from app.services.ai.embeddings import TfIdfEmbedder

MIN_SCORE = 0.05
MAX_PASSAGES = 3


def retrieve(chunks: list[Chunk], question: str, top_k: int = 5) -> list[tuple[Chunk, float]]:
    if not chunks or not question.strip():
        return []
    texts = [c.text for c in chunks]
    try:
        embedder = TfIdfEmbedder()
        embedder.fit(texts + [question])
        vecs = embedder.embed(texts + [question])
    except ValueError:
        return []
    q = vecs[-1]
    scored = [(chunk, float(np.dot(vecs[i], q))) for i, chunk in enumerate(chunks)]
    scored.sort(key=lambda item: item[1], reverse=True)
    return scored[:top_k]


def _cite(chunk: Chunk, score: float) -> dict:
    ref = {"file_id": chunk.file_id, "filename": chunk.filename,
           "chunk": chunk.index, "score": round(score, 3)}
    if chunk.page is not None:
        ref["page"] = chunk.page
    return ref


def answer_local(question: str, scored: list[tuple[Chunk, float]]) -> dict:
    relevant = [(c, s) for c, s in scored if s >= MIN_SCORE][:MAX_PASSAGES]
    if not relevant:
        return {
            "answer": "I couldn't find any passage in your documents relevant to this question. "
                      "Try different keywords, or check that the right files are uploaded and extracted.",
            "citations": [],
            "source": "local-extractive",
            "engine": "local",
        }
    quotes = []
    for chunk, _ in relevant:
        snippet = chunk.text if len(chunk.text) <= 400 else chunk.text[:397] + "…"
        quotes.append(f"“{snippet}” — {chunk.filename}" +
                      (f", page {chunk.page}" if chunk.page else ""))
    plural = "s" if len(relevant) != 1 else ""
    answer = (f"Based on {len(relevant)} quoted passage{plural} from your documents "
              f"(answering: {question.strip()}):\n\n" + "\n\n".join(quotes))
    return {
        "answer": answer,
        "citations": [_cite(c, s) for c, s in relevant],
        "source": "local-extractive",
        "engine": "local",
    }


EXTERNAL_QA_SYSTEM = (
    "You answer questions using ONLY the provided document passages. "
    "Every factual claim must cite its source as [filename, page N]. "
    "If the passages do not contain the answer, say so plainly and do not "
    "invent facts, tasks, progress values, or document contents. "
    "Keep answers under 200 words."
)


def answer_external(question: str, scored: list[tuple[Chunk, float]], llm) -> dict:
    from app.services.ai.providers import DATA_WRAPPER

    relevant = [(c, s) for c, s in scored if s >= MIN_SCORE][:MAX_PASSAGES]
    if not relevant:
        return answer_local(question, [])
    passages = "\n\n".join(
        f"[source {i + 1}: {c.filename}" + (f", page {c.page}" if c.page else "") + f"]\n{c.text}"
        for i, (c, _) in enumerate(relevant)
    )
    user_prompt = (f"{DATA_WRAPPER}\n\n<retrieved-data>\n{passages}\n</retrieved-data>\n\n"
                   f"Question: {question.strip()}")
    try:
        text = llm.complete(EXTERNAL_QA_SYSTEM, user_prompt)
    except Exception as exc:
        fallback = answer_local(question, scored)
        fallback["engine_note"] = f"external LLM failed ({type(exc).__name__}); used local answer"
        return fallback
    return {
        "answer": text,
        "citations": [_cite(c, s) for c, s in relevant],
        "source": "external-llm",
        "engine": "external",
    }
