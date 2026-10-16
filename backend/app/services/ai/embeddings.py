"""Embedding interfaces. The default engine is a local TF-IDF embedder
(scikit-learn, offline, no downloads, no data leaves the server).

External API embedders implement the same Embedder protocol and are only
constructed when global + per-user consent both allow it. Fixed-dimension
external vectors persist via the vector store; TF-IDF refits on the live
corpus per query so vectors can never go stale."""

from typing import Protocol

import numpy as np


class Embedder(Protocol):
    name: str

    def embed(self, texts: list[str]) -> np.ndarray:
        """Return L2-normalized row vectors, shape (len(texts), dim)."""
        ...


class TfIdfEmbedder:
    """Fitted on the user's current corpus (+ query) per search call."""

    name = "tfidf-local"

    def __init__(self) -> None:
        from sklearn.feature_extraction.text import TfidfVectorizer

        self._vectorizer = TfidfVectorizer(
            lowercase=True, stop_words="english",
            ngram_range=(1, 2), max_features=5000, sublinear_tf=True,
        )
        self._fitted = False

    def fit(self, corpus: list[str]) -> None:
        if not corpus:
            raise ValueError("empty corpus")
        self._vectorizer.fit(corpus)
        self._fitted = True

    def embed(self, texts: list[str]) -> np.ndarray:
        if not self._fitted:
            raise RuntimeError("TfIdfEmbedder must be fitted before embed()")
        mat = self._vectorizer.transform(texts).toarray().astype(float)
        norms = np.linalg.norm(mat, axis=1, keepdims=True)
        norms[norms == 0] = 1.0
        return mat / norms


class ExternalEmbedder:
    """OpenAI-compatible /embeddings provider. Never used without consent."""

    def __init__(self, base_url: str, api_key: str, model: str):
        self._base_url = base_url.rstrip("/")
        self._api_key = api_key
        self._model = model
        self.name = f"external:{model}"

    def embed(self, texts: list[str]) -> np.ndarray:
        import httpx

        resp = httpx.post(
            f"{self._base_url}/embeddings",
            headers={"Authorization": f"Bearer {self._api_key}"},
            json={"model": self._model, "input": texts},
            timeout=60,
        )
        resp.raise_for_status()
        data = resp.json()["data"]
        mat = np.array([row["embedding"] for row in data], dtype=float)
        norms = np.linalg.norm(mat, axis=1, keepdims=True)
        norms[norms == 0] = 1.0
        return mat / norms


def get_embedder(
    external_allowed: bool,
    base_url: str,
    api_key: str,
    model: str,
) -> Embedder:
    """Local TF-IDF unless an external provider is explicitly allowed AND
    fully configured. Any gap falls back to local — never fail closed into
    sending data externally."""
    if external_allowed and base_url and api_key and model != "tfidf-local":
        return ExternalEmbedder(base_url, api_key, model)
    return TfIdfEmbedder()
