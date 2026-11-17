"""Deterministic AI Mentor.

ByteXL's AI Mentor is a study coach: a student asks a question ("how do I fix a
CrashLoopBackOff?", "what should I learn after Kubernetes?") and gets a short,
actionable answer. We mirror it with a rule-based responder rather than an LLM,
for the same reasons as ``quality.py`` and ``tutor.py`` (ADR-13): deterministic,
offline, and no copyleft or network dependency.

The responder classifies the question into a topic by keyword, then returns a
hand-written study plan for that topic. Unknown questions fall back to a generic
plan that still points at the student's next concrete step.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

# Topic -> (label, answer, next steps). Ordered: the first keyword that matches
# wins, so more specific topics must be listed before broader ones.
_TOPICS: list[tuple[str, tuple[str, str, list[str]]]] = [
    (
        "kubernetes",
        (
            "Kubernetes",
            "Kubernetes runs containers as declarative objects. Learn the "
            "objects first (Pod, Deployment, Service, ConfigMap), then how a "
            "controller reconciles desired state with the cluster.",
            [
                "Read the Deployment section of the Kubernetes docs.",
                "Run a lab: scale a Deployment and watch the ReplicaSet change.",
                "Practise reading `kubectl describe` output for a failing Pod.",
            ],
        ),
    ),
    (
        "docker",
        (
            "Docker",
            "A container is a process with its own filesystem view. Learn the "
            "image lifecycle (build, tag, push, pull) and how layers cache.",
            [
                "Write a Dockerfile for a small app and build it.",
                "Inspect an image's layers with `docker history`.",
                "Run a container with a mounted volume.",
            ],
        ),
    ),
    (
        "crashloopbackoff",
        (
            "CrashLoopBackOff",
            "CrashLoopBackOff means the container starts, exits, and Kubernetes "
            "restarts it with a growing back-off. Read the previous container's "
            "logs and exit code to find why it stopped.",
            [
                "`kubectl logs <pod> --previous` for the crash reason.",
                "`kubectl describe pod <pod>` for the exit code and events.",
                "Check the container's command and any missing config/secret.",
            ],
        ),
    ),
    (
        "interview",
        (
            "Interview preparation",
            "Interview answers land when they are structured and concrete: state "
            "the situation, the action you took, and the result. Practise out "
            "loud so filler words drop.",
            [
                "Record a mock answer in the AI Interviewer and read the score.",
                "Prepare one STAR story per project on your passport.",
                "Review the vocabulary the interviewer expects for each role.",
            ],
        ),
    ),
    (
        "resume",
        (
            "Resume and portfolio",
            "Recruiters scan for evidence. Lead each line with a technology and "
            "an outcome, and back it with a project or a verified badge.",
            [
                "List three projects with the stack and what they do.",
                "Publish a workspace to GitHub from Nimbus so it is linkable.",
                "Check your Skill Passport for the badges recruiters read.",
            ],
        ),
    ),
    (
        "study",
        (
            "Study plan",
            "Study works when it is spaced and active. Split the topic into "
            "small lessons, attempt each in a lab, then revisit what you missed.",
            [
                "Pick one course and finish a lesson today.",
                "Attempt the assessment in practice mode before graded mode.",
                "Revisit yesterday's lesson before starting a new one.",
            ],
        ),
    ),
    (
        "assessment",
        (
            "Assessments",
            "An assessment checks a specific skill. Read the question, plan the "
            "approach in the editor, then run the visible tests before you submit.",
            [
                "Open the practice attempt first to see the format.",
                "Run the code in the editor before submitting.",
                "Review the feedback on each question after you submit.",
            ],
        ),
    ),
]

_FALLBACK = (
    "General",
    "Break the question into the smallest thing you can try, attempt it in a "
    "lab, and read the error closely — the error text names the fix more often "
    "than not.",
    [
        "Name the one concept you are unsure about.",
        "Find the matching lesson and attempt its lab.",
        "Ask a narrower follow-up once you see the first error.",
    ],
)


@dataclass
class MentorAnswer:
    topic: str
    answer: str
    next_steps: list[str]
    suggested_question: str


def _classify(question: str) -> tuple[str, tuple[str, str, list[str]]]:
    lowered = question.lower()
    for topic, plan in _TOPICS:
        if re.search(rf"\b{re.escape(topic)}\b", lowered):
            return topic, plan
    return "general", _FALLBACK


def mentor_answer(question: str) -> MentorAnswer:
    """Return a study-coach answer for a student's question."""
    topic, (label, answer, steps) = _classify(question)
    return MentorAnswer(
        topic=label,
        answer=answer,
        next_steps=list(steps),
        suggested_question=(
            f"Want me to break '{question.strip()[:80]}' into a one-week plan?"
        ),
    )
