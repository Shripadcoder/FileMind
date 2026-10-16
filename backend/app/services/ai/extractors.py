"""Local document text extraction. Purely offline — no consent gating needed.

Supported: plain text/code/markdown/csv/json, PDF (pypdf), DOCX.
Everything else (images without OCR binaries, archives, spreadsheets,
media) returns None with a reason instead of failing loudly.
Extracted text is untrusted input for every downstream consumer."""

from dataclasses import dataclass, field


@dataclass
class ExtractResult:
    text: str
    method: str  # text | pdf | docx
    page_refs: list[dict] = field(default_factory=list)  # [{page, start, end}]


TEXT_EXTENSIONS = {
    "txt", "md", "csv", "json", "xml", "yml", "yaml", "log",
    "py", "js", "ts", "tsx", "jsx", "java", "c", "h", "cpp",
    "go", "rs", "rb", "php", "html", "css", "sql", "sh",
}


def extract_text(path: str, extension: str, max_chars: int) -> ExtractResult | None:
    ext = (extension or "").lower()
    if ext in TEXT_EXTENSIONS:
        return _extract_plain(path, max_chars)
    if ext == "pdf":
        return _extract_pdf(path, max_chars)
    if ext == "docx":
        return _extract_docx(path, max_chars)
    return None


def _truncate(text: str, max_chars: int) -> str:
    text = text.replace("\x00", "")
    return text[:max_chars]


def _extract_plain(path: str, max_chars: int) -> ExtractResult | None:
    try:
        with open(path, "rb") as fh:
            raw = fh.read(max_chars + 1)
    except OSError:
        return None
    text = _truncate(raw.decode("utf-8", errors="replace"), max_chars)
    if not text.strip():
        return None
    return ExtractResult(text=text, method="text",
                         page_refs=[{"page": 1, "start": 0, "end": len(text)}])


def _extract_pdf(path: str, max_chars: int) -> ExtractResult | None:
    try:
        from pypdf import PdfReader
    except ImportError:
        return None
    try:
        reader = PdfReader(path)
    except Exception:
        return None
    parts: list[str] = []
    page_refs: list[dict] = []
    total = 0
    try:
        for i, page in enumerate(reader.pages):
            try:
                chunk = page.extract_text() or ""
            except Exception:
                chunk = ""
            if chunk:
                if total + len(chunk) > max_chars:
                    chunk = chunk[: max_chars - total]
                start = total
                parts.append(chunk)
                total += len(chunk)
                page_refs.append({"page": i + 1, "start": start, "end": total})
            if total >= max_chars:
                break
    except Exception:
        return None
    text = "\n".join(parts).strip()
    if not text:
        return None
    return ExtractResult(text=text, method="pdf", page_refs=page_refs)


def _extract_docx(path: str, max_chars: int) -> ExtractResult | None:
    try:
        from docx import Document
    except ImportError:
        return None
    try:
        doc = Document(path)
    except Exception:
        return None
    paras = [p.text for p in doc.paragraphs if p.text and p.text.strip()]
    text = _truncate("\n".join(paras), max_chars).strip()
    if not text:
        return None
    return ExtractResult(text=text, method="docx",
                         page_refs=[{"page": 1, "start": 0, "end": len(text)}])
