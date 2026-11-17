"""Deterministic project-copy suggester.

ByteXL's Nimbus offers an AI-generated **title and description** for a new
project ("a clear and catchy name" + "concise and informative" description,
§1.2). We mirror that with a rule-based generator rather than an LLM, for the
same reasons as ``quality.py`` and ``tutor.py`` (ADR-13): it is deterministic,
offline, and adds no copyleft or network dependency.

The generator turns the structural facts it is given — the stack(s), the
component titles, and any free-text hint — into a portfolio-ready name and a
short, factual description. It never invents requirements a student did not
describe; it only *words* what is already there.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

# A stack label ("python", "spring-boot") maps to the product noun a recruiter
# recognises, plus the adjectives worth putting in a title.
_STACKS: dict[str, tuple[str, str]] = {
    "python": ("Python", "service"),
    "python-flask": ("Flask", "web service"),
    "flask": ("Flask", "web service"),
    "java": ("Java", "application"),
    "spring-boot": ("Spring Boot", "backend"),
    "spring": ("Spring", "backend"),
    "react": ("React", "front end"),
    "node": ("Node.js", "service"),
    "nodejs": ("Node.js", "service"),
    "javascript": ("JavaScript", "app"),
    "typescript": ("TypeScript", "app"),
    "mongodb": ("MongoDB", "data layer"),
    "mysql": ("MySQL", "data layer"),
    "postgres": ("PostgreSQL", "data layer"),
    "postgresql": ("PostgreSQL", "data layer"),
    "sqlserver": ("SQL Server", "data layer"),
    "go": ("Go", "service"),
    "rust": ("Rust", "service"),
    "debian": ("Debian", "workspace"),
}

# Words that make a weak title on their own; stripped when deriving one.
_FILLER = {
    "project",
    "app",
    "application",
    "demo",
    "test",
    "my",
    "the",
    "a",
    "an",
}


@dataclass
class CopySuggestion:
    title: str
    description: str
    # Which facts the suggestion was built from, so the UI can explain it.
    based_on: list[str]


def _titlecase(text: str) -> str:
    """Title-case, but keep tokens that already carry capitals (e.g. "REST")."""
    parts = []
    for word in text.split():
        parts.append(word if word.isupper() and len(word) > 1 else word.capitalize())
    return " ".join(parts)


def _derive_subject(hint: str, component_titles: list[str]) -> str:
    """A short subject for the title: the hint, else the first component."""
    for candidate in [hint, *component_titles]:
        cleaned = re.sub(r"[^0-9a-zA-Z ]+", " ", candidate or "").strip()
        words = [w for w in cleaned.split() if w.lower() not in _FILLER]
        if words:
            return " ".join(words[:4])
    return "Cloud Workspace"


def _stack_labels(stacks: list[str]) -> list[tuple[str, str]]:
    """Resolve raw stack strings to (label, noun) pairs, deduped, stable order."""
    seen: dict[str, tuple[str, str]] = {}
    for raw in stacks:
        key = (raw or "").strip().lower()
        if not key:
            continue
        label, noun = _STACKS.get(key, (raw.strip().title(), "application"))
        seen.setdefault(label, (label, noun))
    return list(seen.values())


def suggest_copy(
    *,
    hint: str = "",
    stacks: list[str] | None = None,
    component_titles: list[str] | None = None,
) -> CopySuggestion:
    """Build a title and description from the project's structural facts.

    ``hint`` is the free text the author already typed (used as the subject);
    ``stacks`` are template stack slugs ("python", "spring-boot"); and
    ``component_titles`` are the technology slot names ("Task API", "Web UI").
    """
    stacks = [s for s in (stacks or []) if s]
    component_titles = [t for t in (component_titles or []) if t]
    labels = _stack_labels(stacks)

    subject = _derive_subject(hint, component_titles)

    # Title: "<Subject> — <primary stack>" when there is a stack, else the
    # subject on its own. "Catchy" here means short, specific, and scannable.
    if labels:
        title = f"{_titlecase(subject)} — {labels[0][0]}"
    else:
        title = _titlecase(subject)

    # Description: one sentence naming what is built and on what, then a
    # sentence naming the remaining components, then a sentence on the outcome.
    nouns = [noun for _, noun in labels]
    built = " and ".join(dict.fromkeys(nouns)) if nouns else "application"
    stack_list = ", ".join(label for label, _ in labels)

    sentences: list[str] = []
    if labels:
        sentences.append(f"A {built} built with {stack_list}.")
    else:
        sentences.append("A cloud-hosted project workspace.")

    extras = [t for t in component_titles if t.lower() not in subject.lower()]
    if extras:
        listed = ", ".join(dict.fromkeys(extras[:4]))
        sentences.append(f"Work is split across these components: {listed}.")

    sentences.append(
        "Runs in a cloud VS Code workspace, is deployable on a public URL, and "
        "is submitted for trainer evaluation."
    )

    based_on: list[str] = []
    if stacks:
        based_on.append(f"{len(labels)} stack{'' if len(labels) == 1 else 's'}")
    if component_titles:
        based_on.append(
            f"{len(component_titles)} component"
            f"{'' if len(component_titles) == 1 else 's'}"
        )
    if hint.strip():
        based_on.append("your draft text")

    return CopySuggestion(
        title=title,
        description=" ".join(sentences),
        based_on=based_on,
    )
