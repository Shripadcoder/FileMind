"""Chunking with page tracking. Chunks are recomputed per query from the
stored document text — no chunk table, so content edits can never go stale."""

from dataclasses import dataclass


@dataclass
class Chunk:
    file_id: int
    filename: str
    index: int
    page: int | None
    text: str


def chunk_text(text: str, size: int = 600, overlap: int = 120) -> list[str]:
    text = " ".join(text.split())
    if len(text) <= size:
        return [text] if text else []
    chunks: list[str] = []
    start = 0
    while start < len(text):
        end = min(start + size, len(text))
        if end < len(text):
            # Prefer a sentence/word boundary near the end.
            for sep in (". ", "\n", " "):
                cut = text.rfind(sep, start, end)
                if cut > start + size // 2:
                    end = cut + len(sep)
                    break
        piece = text[start:end].strip()
        if piece:
            chunks.append(piece)
        if end >= len(text):
            break
        start = max(end - overlap, start + 1)
    return chunks


def page_for_offset(page_refs: list[dict], offset: int) -> int | None:
    for ref in page_refs:
        try:
            if ref["start"] <= offset < ref["end"]:
                return int(ref["page"])
        except (KeyError, TypeError, ValueError):
            continue
    return None


def chunk_document(
    file_id: int,
    filename: str,
    text: str,
    page_refs: list[dict],
    size: int = 600,
    overlap: int = 120,
) -> list[Chunk]:
    # Map chunk starts back to source offsets by searching sequentially.
    pieces = chunk_text(text, size=size, overlap=overlap)
    chunks: list[Chunk] = []
    cursor = 0
    flat = " ".join(text.split())
    for i, piece in enumerate(pieces):
        head = piece[:40]
        found = flat.find(head, cursor)
        offset = found if found != -1 else cursor
        chunks.append(Chunk(
            file_id=file_id, filename=filename, index=i,
            page=page_for_offset(page_refs, offset), text=piece,
        ))
        cursor = offset + max(len(piece) - overlap, 1)
    return chunks
