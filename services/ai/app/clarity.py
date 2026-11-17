"""Clarity — CEFR-graded English practice (parity §2.10).

Scores one practice response across the four Clarity skills (reading, writing,
listening, speaking) on a 0-100 scale, then maps that score to a CEFR band
(A1-C2) so a student can see their level per skill. Scoring is deterministic and
grounded in the response text — content coverage is measured against a task's
expected terms — so a band never depends on a model's mood.

The bands are the Council of Europe's six reference levels, grouped into the
usual three tiers (Basic A1-A2, Independent B1-B2, Proficient C1-C2).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

# CEFR bands, ordered low to high. A band's inclusive upper score bound is the
# tuple's second element; the last band is open-ended.
CEFR_BANDS: list[tuple[str, int]] = [
    ("A1", 24),
    ("A2", 39),
    ("B1", 54),
    ("B2", 69),
    ("C1", 84),
    ("C2", 100),
]

SKILLS = frozenset({"reading", "writing", "listening", "speaking"})

# How much each dimension counts toward the overall score, per skill. Reading and
# listening lean on content coverage (did they understand the material); writing
# weights grammar highest; speaking keeps a large fluency share for fillers.
_WEIGHTS: dict[str, dict[str, float]] = {
    "reading": {"content": 0.5, "vocabulary": 0.2, "grammar": 0.15, "fluency": 0.15},
    "writing": {"content": 0.3, "vocabulary": 0.25, "grammar": 0.3, "fluency": 0.15},
    "listening": {"content": 0.5, "vocabulary": 0.2, "grammar": 0.15, "fluency": 0.15},
    "speaking": {"content": 0.3, "vocabulary": 0.2, "grammar": 0.2, "fluency": 0.3},
}

FILLERS = frozenset(
    {
        "um", "uh", "erm", "ah", "like", "basically", "actually", "literally",
        "you know", "i mean", "sort of", "kind of",
    }
)


@dataclass
class ClarityReport:
    skill: str
    score: int
    band: str
    grammar: int
    vocabulary: int
    content: int
    fluency: int
    matched_terms: list[str] = field(default_factory=list)
    feedback: list[str] = field(default_factory=list)


def cefr_band(score: int) -> str:
    """Map a 0-100 score to a CEFR band (A1-C2)."""
    for name, upper in CEFR_BANDS:
        if score <= upper:
            return name
    return "C2"


def _words(text: str) -> list[str]:
    return re.findall(r"[A-Za-z']+", text.lower())


def _grammar_score(transcript: str, sentences: list[str]) -> int:
    """A deterministic grammar proxy: sentence length sanity + capitalisation."""
    score = 100
    avg_len = sum(len(_words(s)) for s in sentences) / max(len(sentences), 1)
    if avg_len > 40:
        score -= 20
    if transcript and not transcript[0].isupper():
        score -= 10
    if not sentences:
        score = 40
    return max(0, score)


def _vocabulary_score(words: list[str]) -> int:
    """Type-token ratio, gently floored so a crisp short answer is not punished."""
    n = max(len(words), 1)
    distinct = len(set(words))
    return min(100, int(60 + 40 * (distinct / n)))


def _content_score(lowered: str, expected: list[str], words: list[str]) -> tuple[int, list[str]]:
    """Coverage of a task's expected terms, or length adequacy when none given."""
    if expected:
        matched = [t for t in expected if t in lowered]
        return int(100 * len(matched) / len(expected)), matched
    # No key terms: reward a developed answer, but not without bound.
    return min(100, len(words) * 5), []


def _fluency_score(skill: str, transcript: str, words: list[str], sentences: list[str]) -> int:
    """Fluency: filler penalty for spoken skills, structure for written ones."""
    if skill in ("speaking", "listening"):
        n = max(len(words), 1)
        filler_hits = sum(transcript.lower().count(f) for f in FILLERS)
        return max(0, 100 - int(100 * filler_hits / n) * 3)
    # Written: reward a couple of sentences without rambling.
    return min(100, len(sentences) * 40)


def _feedback(
    skill: str, grammar: int, vocabulary: int, content: int, fluency: int
) -> list[str]:
    """One actionable note per weak dimension, strongest signal first."""
    notes: list[str] = []
    if content < 60:
        notes.append(
            "Cover the key points of the task — name the ideas the prompt expects."
        )
    if grammar < 80:
        notes.append("Check sentence length and punctuation; keep one idea per sentence.")
    if vocabulary < 70:
        notes.append("Vary your word choice to show range.")
    if fluency < 70:
        if skill in ("speaking", "listening"):
            notes.append("Reduce filler words (um, like, basically) for a cleaner delivery.")
        else:
            notes.append("Develop your answer into two or three clear sentences.")
    if not notes:
        notes.append("Strong response — keep this level up.")
    return notes


def evaluate_clarity(
    skill: str,
    response: str,
    expected_terms: list[str] | None = None,
) -> ClarityReport:
    """Score one Clarity response and place it on the CEFR scale.

    `skill` is one of reading / writing / listening / speaking. An unknown skill
    is scored on the writing weights (the most balanced) rather than rejected, so
    a caller never gets a crash for a typo'd skill.
    """
    key = skill if skill in SKILLS else "writing"
    weights = _WEIGHTS[key]

    text = response.strip()
    words = _words(text)
    lowered = text.lower()
    sentences = [s for s in re.split(r"[.!?]+", text) if s.strip()]

    grammar = _grammar_score(text, sentences)
    vocabulary = _vocabulary_score(words)
    content, matched = _content_score(lowered, [t.lower() for t in (expected_terms or [])], words)
    fluency = _fluency_score(key, text, words, sentences)

    score = int(
        weights["content"] * content
        + weights["vocabulary"] * vocabulary
        + weights["grammar"] * grammar
        + weights["fluency"] * fluency
    )

    return ClarityReport(
        skill=key,
        score=score,
        band=cefr_band(score),
        grammar=grammar,
        vocabulary=vocabulary,
        content=content,
        fluency=fluency,
        matched_terms=matched,
        feedback=_feedback(key, grammar, vocabulary, content, fluency),
    )
