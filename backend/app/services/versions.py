"""Document version detection + comparison (local, rule-based).

Detection is a transparent filename heuristic, never a claim of authorship:
files in the same folder with the same extension whose names match after
stripping version tokens (v1, v2, _final, _draft, (1), dates like 2024-01-31)
are reported as *likely* versions with the reason shown. Users confirm by
linking/organizing; nothing is auto-merged.

Comparison diffs the locally extracted texts with difflib. Files without
extracted text cannot be compared (415 with a clear reason)."""

import difflib
import re

VERSION_TOKEN = re.compile(
    r"(?i)[\s._-]*(\bv?\d{1,3}\b|final|draft|revised|rev\d*|\(\d+\)|\d{4}[-_.]\d{2}[-_.]\d{2})$"
)
DATE_PREFIX = re.compile(r"^\d{4}[-_.]\d{2}[-_.]\d{2}[\s._-]+")
MAX_DIFF_LINES = 500


def normalize_stem(filename: str) -> str:
    stem = filename.rsplit(".", 1)[0] if "." in filename else filename
    stem = DATE_PREFIX.sub("", stem.strip())
    prev = None
    while prev != stem:
        prev = stem
        stem = VERSION_TOKEN.sub("", stem).strip(" ._-")
    return stem.lower()


def version_sort_key(filename: str) -> tuple:
    """Best-effort ordering: explicit version numbers first, then name."""
    stem = filename.rsplit(".", 1)[0] if "." in filename else filename
    numbers = [int(n) for n in re.findall(r"\d{1,4}", stem)]
    tags = ["final", "revised", "draft", "v"]
    lowered = stem.lower()
    tag_rank = next((i for i, tag in enumerate(tags) if tag in lowered), len(tags))
    return (numbers[-1] if numbers else 0, tag_rank, filename.lower())


def group_versions(files: list) -> list[dict]:
    """files: File rows (any iterable with folder_id/original_filename/mime info).
    Returns groups sorted newest-first guess, each with reason + files."""
    buckets: dict[tuple, list] = {}
    for file in files:
        ext = file.original_filename.rsplit(".", 1)[-1].lower() if "." in file.original_filename else ""
        key = (file.folder_id, ext, normalize_stem(file.original_filename))
        buckets.setdefault(key, []).append(file)
    groups = []
    for (folder_id, ext, stem), members in buckets.items():
        if len(members) < 2 or not stem:
            continue
        ordered = sorted(members, key=lambda f: version_sort_key(f.original_filename))
        groups.append({
            "key": f"{folder_id}:{ext}:{stem}",
            "stem": stem,
            "folder_id": folder_id,
            "extension": ext,
            "reason": "same folder, same type, names differ only by version-like tokens",
            "source": "filename-heuristic",
            "files": ordered,
        })
    groups.sort(key=lambda g: len(g["files"]), reverse=True)
    return groups


def compare_texts(a: str, b: str, name_a: str, name_b: str,
                  max_lines: int = MAX_DIFF_LINES) -> dict:
    a_lines = a.splitlines()
    b_lines = b.splitlines()
    matcher = difflib.SequenceMatcher(None, a_lines, b_lines, autojunk=False)
    ratio = round(matcher.ratio(), 3)
    added = removed = 0
    opcodes = []
    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            opcodes.append({"type": "equal", "a": [i1, i2], "b": [j1, j2]})
        elif tag == "delete":
            removed += i2 - i1
            opcodes.append({"type": "removed", "a": [i1, i2], "b": [j1, j2],
                            "lines": a_lines[i1:i2][:max_lines]})
        elif tag == "insert":
            added += j2 - j1
            opcodes.append({"type": "added", "a": [i1, i2], "b": [j1, j2],
                            "lines": b_lines[j1:j2][:max_lines]})
        else:  # replace
            removed += i2 - i1
            added += j2 - j1
            opcodes.append({"type": "removed", "a": [i1, i2], "b": [j1, j2],
                            "lines": a_lines[i1:i2][:max_lines]})
            opcodes.append({"type": "added", "a": [i1, i2], "b": [j1, j2],
                            "lines": b_lines[j1:j2][:max_lines]})
    return {
        "similarity": ratio,
        "added_lines": added,
        "removed_lines": removed,
        "total_a": len(a_lines),
        "total_b": len(b_lines),
        "opcodes": opcodes[:max_lines],
        "truncated": len(opcodes) > max_lines,
        "names": {"a": name_a, "b": name_b},
    }
