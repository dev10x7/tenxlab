"""Deterministic code-quality scoring.

Produces a 0-100 score plus a list of issues from structural heuristics. This is
intentionally explainable: every point lost maps to a named, reviewable issue.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field


@dataclass
class Issue:
    code: str
    message: str
    line: int | None = None


@dataclass
class QualityReport:
    score: int
    issues: list[Issue] = field(default_factory=list)

    @property
    def issue_count(self) -> int:
        return len(self.issues)


_RULES: list[tuple[str, re.Pattern[str], int, str]] = [
    ("todo-left", re.compile(r"\b(TODO|FIXME|XXX)\b"), 5, "Unresolved TODO/FIXME marker"),
    ("print-debug", re.compile(r"\b(console\.log|System\.out\.println|print)\s*\("), 2, "Debug print left in code"),
    ("long-line", re.compile(r".{121,}"), 1, "Line exceeds 120 characters"),
    ("bare-except", re.compile(r"except\s*:"), 5, "Bare except swallows all errors"),
    ("hardcoded-secret", re.compile(r"(password|secret|api[_-]?key)\s*=\s*['\"][^'\"]+['\"]", re.IGNORECASE), 15, "Hardcoded credential"),
    ("eval-use", re.compile(r"\beval\s*\("), 10, "Use of eval() is unsafe"),
]


def score_quality(source: str) -> QualityReport:
    issues: list[Issue] = []
    for lineno, line in enumerate(source.splitlines(), start=1):
        for code, pattern, _penalty, message in _RULES:
            if pattern.search(line):
                issues.append(Issue(code=code, message=message, line=lineno))

    penalty = 0
    for code, pattern, rule_penalty, _msg in _RULES:
        occurrences = sum(1 for i in issues if i.code == code)
        penalty += rule_penalty * occurrences

    score = max(0, 100 - penalty)
    return QualityReport(score=score, issues=issues)
