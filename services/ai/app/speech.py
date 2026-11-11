"""Communication / speech evaluation.

Scores a transcript on grammar, vocabulary, filler words, and technical
accuracy. Technical accuracy is measured against a list of expected key terms
for the prompt, so the score is grounded rather than model-hallucinated.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

FILLERS = frozenset(
    {
        "um", "uh", "erm", "ah", "like", "basically", "actually", "literally",
        "you know", "i mean", "sort of", "kind of",
    }
)

_TECH_VOCAB = frozenset(
    {
        "kubernetes", "pod", "deployment", "service", "cluster", "container",
        "docker", "image", "namespace", "replica", "ingress", "node", "kubectl",
        "yaml", "helm", "scaling", "rollout", "configmap", "secret", "volume",
    }
)


@dataclass
class SpeechReport:
    communication_score: int
    grammar: int
    vocabulary: int
    filler_words: int
    technical_accuracy: int
    matched_terms: list[str]


def _words(text: str) -> list[str]:
    return re.findall(r"[A-Za-z']+", text.lower())


def evaluate_speech(transcript: str, expected_terms: list[str] | None = None) -> SpeechReport:
    words = _words(transcript)
    n = max(len(words), 1)
    lowered = transcript.lower()

    # Filler-word score: fewer fillers -> higher score.
    filler_hits = sum(lowered.count(f) for f in FILLERS)
    filler_score = max(0, 100 - int(100 * filler_hits / n) * 3)
    filler_score = max(0, filler_score)

    # Vocabulary: ratio of distinct words, scaled. Short answers are penalised
    # gently so a crisp correct answer is not scored below a rambling one.
    distinct = len(set(words))
    vocab_score = min(100, int(60 + 40 * (distinct / n)))

    # Grammar proxy: sentence length sanity + capitalisation after periods.
    sentences = [s for s in re.split(r"[.!?]+", transcript) if s.strip()]
    avg_len = sum(len(_words(s)) for s in sentences) / max(len(sentences), 1)
    grammar_score = 100
    if avg_len > 40:
        grammar_score -= 20
    if transcript and not transcript[0].isupper():
        grammar_score -= 10
    if not sentences:
        grammar_score = 40
    grammar_score = max(0, grammar_score)

    # Technical accuracy: expected-term coverage plus general tech vocabulary.
    expected = [t.lower() for t in (expected_terms or [])]
    if expected:
        matched = [t for t in expected if t in lowered]
        tech_score = int(100 * len(matched) / len(expected))
    else:
        matched = [t for t in _TECH_VOCAB if t in lowered]
        tech_score = min(100, len(matched) * 20)

    overall = int(
        0.3 * grammar_score
        + 0.2 * vocab_score
        + 0.2 * filler_score
        + 0.3 * tech_score
    )

    return SpeechReport(
        communication_score=overall,
        grammar=grammar_score,
        vocabulary=vocab_score,
        filler_words=filler_score,
        technical_accuracy=tech_score,
        matched_terms=matched,
    )
