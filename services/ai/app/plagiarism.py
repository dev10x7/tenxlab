"""Code plagiarism detection.

Uses a token-based fingerprint (winnowing) over normalized source. This is a
real, dependency-free algorithm — not a stub — so the LMS can flag MOSS-style
similarity without a third-party service. It deliberately reports *candidate*
matches; an instructor reviews the diff before any action is taken.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

_TOKEN_RE = re.compile(r"[A-Za-z_][A-Za-z0-9_]*|\d+|\S")

_KEYWORDS = frozenset(
    {
        "if", "else", "for", "while", "return", "def", "class", "import",
        "from", "try", "except", "finally", "with", "as", "in", "is", "not",
        "and", "or", "None", "True", "False", "lambda", "yield", "pass",
        "break", "continue", "raise", "global", "nonlocal", "assert", "del",
        "public", "private", "static", "void", "int", "float", "double",
        "char", "string", "bool", "new", "this", "const", "let", "var",
        "function", "struct", "package", "func", "type", "range", "nil",
    }
)


def normalize(source: str) -> list[str]:
    """Lowercase, strip comments/strings, then alpha-rename identifiers.

    Keywords, operators, and punctuation are kept verbatim. Non-keyword
    identifiers are replaced by ``ID1``, ``ID2``, ... in order of first
    appearance, and numbers by ``NUM``. Alpha-renaming preserves rename
    invariance (``add(x, y)`` and ``add(first, second)`` match) without
    collapsing all identifiers to a single symbol, which would make unrelated
    programs look structurally identical.
    """
    # Remove block comments, line comments, and string literals.
    no_block = re.sub(r"/\*.*?\*/", " ", source, flags=re.DOTALL)
    no_line = re.sub(r"//[^\n]*|#[^\n]*", " ", no_block)
    no_strings = re.sub(r"\"(\\.|[^\"\\])*\"|'(\\.|[^'\\])*'", '""', no_line)

    renamed: dict[str, str] = {}
    tokens: list[str] = []
    for raw in _TOKEN_RE.findall(no_strings):
        if raw in _KEYWORDS:
            tokens.append(raw)
        elif raw.isdigit():
            tokens.append("NUM")
        elif raw.isidentifier():
            key = raw.lower()
            if key not in renamed:
                renamed[key] = f"ID{len(renamed) + 1}"
            tokens.append(renamed[key])
        else:
            tokens.append(raw)
    return tokens


def winnow(tokens: list[str], k: int = 5, window: int = 4) -> set[int]:
    """Return the set of k-gram hashes selected by a winnowing window."""
    if len(tokens) < k:
        return {hash(tuple(tokens))} if tokens else set()
    grams = [hash(tuple(tokens[i : i + k])) for i in range(len(tokens) - k + 1)]
    if len(grams) <= window:
        return set(grams)
    selected: set[int] = set()
    for i in range(len(grams) - window + 1):
        selected.add(min(grams[i : i + window]))
    return selected


def similarity(a: str, b: str) -> float:
    """Jaccard similarity of winnowed fingerprints, in [0, 1]."""
    fa, fb = winnow(normalize(a)), winnow(normalize(b))
    if not fa and not fb:
        return 1.0
    if not fa or not fb:
        return 0.0
    inter = len(fa & fb)
    union = len(fa | fb)
    return inter / union if union else 0.0


@dataclass
class Match:
    student_id: str
    similarity: float


@dataclass
class PlagiarismReport:
    subject_student_id: str
    max_similarity: float
    matches: list[Match] = field(default_factory=list)
    flagged: bool = False


def compare_against_cohort(
    subject_id: str,
    subject_code: str,
    cohort: dict[str, str],
    threshold: float = 0.75,
) -> PlagiarismReport:
    """Compare one submission against every other submission in the cohort."""
    matches: list[Match] = []
    for other_id, other_code in cohort.items():
        if other_id == subject_id:
            continue
        score = similarity(subject_code, other_code)
        if score > 0:
            matches.append(Match(student_id=other_id, similarity=round(score, 4)))
    matches.sort(key=lambda m: m.similarity, reverse=True)
    max_sim = matches[0].similarity if matches else 0.0
    return PlagiarismReport(
        subject_student_id=subject_id,
        max_similarity=max_sim,
        matches=matches,
        flagged=max_sim >= threshold,
    )
