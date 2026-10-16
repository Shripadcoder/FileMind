"""Extractive summarization (local). Selects the highest-scoring sentences by
term frequency, preserving original wording — so summaries cannot hallucinate
facts that are not in the document. Source label: local-extractive."""

import re

MAX_SENTENCES = 5
MAX_CHARS = 1200


def split_sentences(text: str) -> list[str]:
    text = " ".join(text.split())
    parts = re.split(r"(?<=[.!?])\s+(?=[A-Z0-9\"'])", text)
    return [p.strip() for p in parts if len(p.strip()) > 20]


def summarize(text: str, max_sentences: int = MAX_SENTENCES,
              max_chars: int = MAX_CHARS) -> dict:
    sentences = split_sentences(text)
    if not sentences:
        return {"summary": "", "source": "local-extractive", "sentence_count": 0}
    if len(sentences) <= max_sentences:
        joined = " ".join(sentences)[:max_chars]
        return {"summary": joined, "source": "local-extractive",
                "sentence_count": len(sentences)}
    # Term-frequency scoring with light position bias (earlier = more likely intro).
    freq: dict[str, int] = {}
    words = re.findall(r"[a-z]{3,}", text.lower())
    stop = {"the", "and", "for", "with", "that", "this", "from", "have", "are",
            "was", "were", "been", "has", "had", "will", "would", "can", "its",
            "which", "their", "there", "they", "them", "then", "than", "into",
            "such", "also", "over", "under", "between", "about", "after"}
    for word in words:
        if word not in stop:
            freq[word] = freq.get(word, 0) + 1
    scored: list[tuple[float, int, str]] = []
    for i, sentence in enumerate(sentences):
        tokens = re.findall(r"[a-z]{3,}", sentence.lower())
        if not tokens:
            continue
        score = sum(freq.get(t, 0) for t in tokens) / len(tokens)
        score *= 1.0 + 0.3 * (1 - i / len(sentences))
        scored.append((score, i, sentence))
    scored.sort(reverse=True)
    chosen = sorted(scored[:max_sentences], key=lambda item: item[1])
    out: list[str] = []
    total = 0
    for _, _, sentence in chosen:
        if total + len(sentence) > max_chars and out:
            break
        out.append(sentence)
        total += len(sentence)
    return {"summary": " ".join(out), "source": "local-extractive",
            "sentence_count": len(out)}
