"""Content-based category/tag suggestions (local, deterministic).

- Category: cosine similarity between the document and per-category centroids
  built from the user's already-categorized document texts, blended with a
  small bonus for literal category-name mentions. Falls back to no suggestion
  when the user has no categorized corpus yet (never invents confidence).
- Tags: top TF-IDF terms intersected with the user's existing tag vocabulary,
  plus novel single-word candidates. Source label: local-content.

Accept/reject/modify happens through the existing PATCH /files/{id} endpoint —
this module only proposes."""

import re

import numpy as np

from app.services.ai.chunking import chunk_text
from app.services.ai.embeddings import TfIdfEmbedder

CATEGORY_KEYWORDS = {
    "Education": {"lecture", "course", "tutorial", "chapter", "exercise", "exam", "student"},
    "Projects": {"project", "milestone", "deliverable", "roadmap", "plan"},
    "Programming": {"function", "class", "import", "return", "code", "def", "const"},
    "Certificates": {"certificate", "certification", "awarded", "completion", "credential"},
    "Documents": {"document", "report", "memo", "agreement", "letter"},
    "Images": {"image", "photo", "figure", "diagram"},
    "Finance": {"invoice", "payment", "budget", "balance", "tax", "receipt", "expense"},
    "Personal": {"personal", "diary", "note", "todo"},
}


def _tokens(text: str) -> list[str]:
    return re.findall(r"[a-z]{3,}", text.lower())


def suggest_category(
    text: str,
    corpus_by_category: dict[str, list[str]],
    candidate_names: list[str],
) -> dict | None:
    """Return {category, confidence, source} or None when there is no basis."""
    if not text.strip() or not candidate_names:
        return None
    usable = {name: docs for name, docs in corpus_by_category.items()
              if name in candidate_names and docs}
    scores: dict[str, float] = {name: 0.0 for name in candidate_names}

    if usable:
        try:
            corpus = [d for docs in usable.values() for d in docs] + [text]
            embedder = TfIdfEmbedder()
            embedder.fit(corpus)
            vecs = embedder.embed(corpus)
            doc_vec = vecs[-1]
            idx = 0
            for name, docs in usable.items():
                members = vecs[idx: idx + len(docs)]
                idx += len(docs)
                centroid = members.mean(axis=0)
                denom = (np.linalg.norm(doc_vec) * np.linalg.norm(centroid)) or 1.0
                scores[name] = float(np.dot(doc_vec, centroid) / denom)
        except ValueError:
            pass

    words = set(_tokens(text))
    for name in candidate_names:
        keywords = CATEGORY_KEYWORDS.get(name, set()) | set(_tokens(name))
        overlap = len(words & keywords)
        if overlap:
            scores[name] += 0.05 * overlap

    best = max(scores, key=lambda k: scores[k])
    if scores[best] <= 0:
        return None
    return {
        "category": best,
        "confidence": round(min(scores[best], 1.0), 3),
        "source": "local-content",
    }


def suggest_tags(
    text: str,
    existing_tags: list[str],
    top_n: int = 8,
) -> dict:
    """Rank the user's own tag vocabulary by TF-IDF weight in this document,
    and propose up to a few novel terms. Never invents tags beyond the text."""
    pieces = chunk_text(text) or [text]
    try:
        embedder = TfIdfEmbedder()
        embedder.fit(pieces)
        feature_names = embedder._vectorizer.get_feature_names_out()
        vec = embedder.embed([" ".join(pieces)])[0]
    except (ValueError, RuntimeError):
        return {"tags": [], "novel": [], "source": "local-content"}
    order = np.argsort(vec)[::-1]
    ranked = [str(feature_names[i]) for i in order if vec[i] > 0]

    vocab = {t.lower(): t for t in existing_tags}
    matched = [vocab[w] for w in ranked if w in vocab][:top_n]
    novel = [w for w in ranked
             if w not in vocab and re.fullmatch(r"[a-z]{3,20}", w)][:3]
    return {"tags": matched, "novel": novel, "source": "local-content"}
