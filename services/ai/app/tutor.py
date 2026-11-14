"""Deterministic, explainable code tutor.

Two modes, one implementation:

- ``socratic`` — explains the root cause and asks a guiding question, never
  returning a solution. This is the only mode reachable from a graded
  assessment, where a pasteable answer would leak the exercise.
- ``assist`` — the practice-editor behaviour (ByteXL's contextual assistant):
  the same explanation, plus a cleaned-up version of the code the student can
  apply.

The reviewer is deliberately rule-based, like ``quality.py``: no LLM, so it is
deterministic, offline, and adds no copyleft dependency (ADR-13). It reuses the
quality rules for issues and pattern-matches the runtime error the student hit.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from .quality import Issue, score_quality

SOCRATIC = "socratic"
ASSIST = "assist"
MODES = (SOCRATIC, ASSIST)


@dataclass
class TutorReview:
    mode: str
    score: int
    issues: list[Issue] = field(default_factory=list)
    explanation: str = ""
    corrected_code: str | None = None
    follow_up_question: str | None = None

    @property
    def issue_count(self) -> int:
        return len(self.issues)


# Runtime errors worth naming, in the order we test them. Each maps to a plain
# explanation and a guiding question a tutor would ask.
_ERROR_RULES: list[tuple[re.Pattern[str], str, str]] = [
    (
        re.compile(
            r"\bSyntaxError\b|\bIndentationError\b|';' expected|expected '\)'|unexpected token",
            re.I,
        ),
        "The code does not parse, so the program never ran.",
        "Look at the line the error names — is a bracket, quote or indentation out of place?",
    ),
    (
        re.compile(
            r"\bNameError\b|is not defined|cannot find symbol|undefined (variable|reference)",
            re.I,
        ),
        "Something is used before it exists or under a different name.",
        "Where is that name first given a value, and does the spelling match everywhere?",
    ),
    (
        re.compile(r"\bTypeError\b|incompatible types|no implicit conversion", re.I),
        "Two values of different types are being combined.",
        "What type is each side of that operation, and what type did the code expect?",
    ),
    (
        re.compile(r"\bIndexError\b|out of range|IndexOutOfBounds|array index", re.I),
        "The code reads past the end of a sequence.",
        "What is the length of the sequence, and what is the largest valid index?",
    ),
    (
        re.compile(r"\bKeyError\b|NoSuchElementException", re.I),
        "A lookup asked for a key that is not present.",
        "Does that key definitely exist at the point of the lookup?",
    ),
    (
        re.compile(r"NullPointerException|null reference|nil\b|NoneType", re.I),
        "Something that was expected to hold a value is empty.",
        "Which value is missing, and what should happen when it is?",
    ),
    (
        re.compile(r"\bpanic:|\bsegmentation fault\b|error\[E\d+\]|thread '.*' panicked", re.I),
        "The program aborted at the point the error names.",
        "What did the failing line assume was true that the input breaks?",
    ),
    (
        re.compile(r"No such file|FileNotFoundError|cannot find the file", re.I),
        "A file the program expected was not found.",
        "Is the path relative to where the program runs, and does the file exist there?",
    ),
]

# Comment markers that introduce a scaffold note we can safely strip.
_MARKER = re.compile(r"\b(start|end) your solution\b", re.I)
_TODO_LINE = re.compile(r"^\s*(//|#|--|/\*|\*)\s*(TODO|FIXME|XXX)\b", re.I)
_TODO_TRAILING = re.compile(r"\s*(//|#|--)\s*(TODO|FIXME|XXX)\b.*$", re.I)


def sanitize_source(source: str) -> str:
    """Remove in-file exercise region markers before analysis.

    The marker comments ("start/end your solution") are scaffolding, not the
    student's code; leaving them in would let the reviewer talk about the
    scaffold instead of the solution.
    """
    kept = [line for line in source.splitlines() if not _MARKER.search(line)]
    return "\n".join(kept)


def clean_code(source: str) -> str:
    """A conservative auto-fix: strip TODO markers and trailing whitespace.

    Deliberately small. It removes what is unambiguously noise without
    inventing logic the student did not write.
    """
    out: list[str] = []
    for line in source.splitlines():
        if _TODO_LINE.match(line):
            continue
        out.append(_TODO_TRAILING.sub("", line).rstrip())
    while out and out[-1] == "":
        out.pop()
    return "\n".join(out) + ("\n" if out else "")


def _classify_error(stderr: str) -> tuple[str, str] | None:
    for pattern, explanation, question in _ERROR_RULES:
        if pattern.search(stderr):
            return explanation, question
    return None


def _summarise(issues: list[Issue], explanation: str | None) -> str:
    if explanation:
        base = explanation
    elif issues:
        base = f"I found {len(issues)} thing(s) worth a look."
    else:
        base = "I do not see a structural problem in this code."
    if issues:
        first = issues[0]
        where = f" (line {first.line})" if first.line else ""
        base += f" Start with: {first.message.lower()}{where}."
    return base


def review_code(source: str, mode: str = ASSIST, stderr: str = "") -> TutorReview:
    """Review ``source`` and, in assist mode, return a cleaned version."""
    if mode not in MODES:
        raise ValueError(f"unknown tutor mode: {mode}")

    clean = sanitize_source(source)
    report = score_quality(clean)
    classified = _classify_error(stderr) if stderr else None
    explanation = _summarise(report.issues, classified[0] if classified else None)

    if mode == ASSIST:
        corrected = clean_code(clean)
        # Only offer a correction when it actually differs from what was sent.
        corrected_code = corrected if corrected.strip() != clean.strip() else None
        question = None
    else:
        corrected_code = None
        question = classified[1] if classified else (
            report.issues[0].message + " — where does that come from?"
            if report.issues
            else "What did you expect this code to do, step by step?"
        )

    return TutorReview(
        mode=mode,
        score=report.score,
        issues=report.issues,
        explanation=explanation,
        corrected_code=corrected_code,
        follow_up_question=question,
    )
