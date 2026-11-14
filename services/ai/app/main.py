"""FastAPI application for the TenXLab AI/assessment plane."""

from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone

import httpx
from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, Field

from .plagiarism import compare_against_cohort
from .quality import score_quality
from .speech import evaluate_speech
from .tutor import ASSIST, MODES, review_code
from .webhooks import signed_payload

app = FastAPI(title="TenXLab AI Plane", version="0.1.0")

LMS_WEBHOOK_URL = os.environ.get("LMS_WEBHOOK_URL", "")
WEBHOOK_SECRET = os.environ.get("WEBHOOK_SECRET", "dev-webhook-secret")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _emit(payload: dict) -> None:
    """Deliver a signed webhook to the LMS. No-op when no URL is configured."""
    if not LMS_WEBHOOK_URL:
        return
    body, signature = signed_payload(WEBHOOK_SECRET, payload)
    async with httpx.AsyncClient(timeout=10) as client:
        await client.post(
            LMS_WEBHOOK_URL,
            content=body,
            headers={
                "content-type": "application/json",
                "x-tenxlab-signature-256": signature,
            },
        )


# ------------------------------------------------------------------ schemas


class Submission(BaseModel):
    student_id: str
    code: str


class PlagiarismRequest(BaseModel):
    tenant_id: str
    exercise_id: str
    submissions: list[Submission]
    threshold: float = Field(default=0.75, ge=0, le=1)


class QualityRequest(BaseModel):
    tenant_id: str
    project_id: str
    student_id: str
    code: str


class SpeechRequest(BaseModel):
    tenant_id: str
    student_id: str
    prompt_id: str
    transcript: str
    expected_terms: list[str] = Field(default_factory=list)


class TutorRequest(BaseModel):
    language: str
    code: str
    # `assist` (practice editor; may return corrected code) or `socratic`
    # (guardrailed; the only mode a graded assessment may reach).
    mode: str = ASSIST
    # The runtime error the student just hit, when there is one.
    stderr: str = ""


# ------------------------------------------------------------------ routes


@app.get("/healthz")
def healthz() -> dict:
    return {"status": "ok", "version": app.version}


@app.post("/v1/plagiarism/score")
async def plagiarism_score(req: PlagiarismRequest) -> dict:
    if len(req.submissions) < 1:
        raise HTTPException(status_code=422, detail="No submissions provided")

    cohort = {s.student_id: s.code for s in req.submissions}
    results = []
    for sub in req.submissions:
        report = compare_against_cohort(
            sub.student_id, sub.code, cohort, threshold=req.threshold
        )
        results.append(report)
        await _emit(
            {
                "event": "plagiarism.scored",
                "event_id": str(uuid.uuid4()),
                "tenant_id": req.tenant_id,
                "exercise_id": req.exercise_id,
                "subject_student_id": report.subject_student_id,
                "max_similarity": report.max_similarity,
                "matches": [
                    {"student_id": m.student_id, "similarity": m.similarity}
                    for m in report.matches
                ],
                "flagged": report.flagged,
            }
        )

    return {
        "scored_at": _now_iso(),
        "results": [
            {
                "student_id": r.subject_student_id,
                "max_similarity": r.max_similarity,
                "flagged": r.flagged,
                "matches": [
                    {"student_id": m.student_id, "similarity": m.similarity}
                    for m in r.matches
                ],
            }
            for r in results
        ],
    }


@app.post("/v1/quality/score")
async def quality_score(req: QualityRequest) -> dict:
    report = score_quality(req.code)
    await _emit(
        {
            "event": "quality.scored",
            "event_id": str(uuid.uuid4()),
            "tenant_id": req.tenant_id,
            "project_id": req.project_id,
            "student_id": req.student_id,
            "score": report.score,
            "issues": report.issue_count,
        }
    )
    return {
        "score": report.score,
        "issue_count": report.issue_count,
        "issues": [
            {"code": i.code, "message": i.message, "line": i.line}
            for i in report.issues
        ],
    }


@app.post("/v1/speech/evaluate")
async def speech_evaluate(req: SpeechRequest) -> dict:
    report = evaluate_speech(req.transcript, req.expected_terms)
    await _emit(
        {
            "event": "speech.evaluated",
            "event_id": str(uuid.uuid4()),
            "tenant_id": req.tenant_id,
            "student_id": req.student_id,
            "prompt_id": req.prompt_id,
            "communication_score": report.communication_score,
            "breakdown": {
                "grammar": report.grammar,
                "vocabulary": report.vocabulary,
                "filler_words": report.filler_words,
                "technical_accuracy": report.technical_accuracy,
            },
        }
    )
    return {
        "communication_score": report.communication_score,
        "breakdown": {
            "grammar": report.grammar,
            "vocabulary": report.vocabulary,
            "filler_words": report.filler_words,
            "technical_accuracy": report.technical_accuracy,
        },
        "matched_terms": report.matched_terms,
    }


@app.post("/v1/tutor/review")
async def tutor_review(req: TutorRequest) -> dict:
    if req.mode not in MODES:
        raise HTTPException(status_code=422, detail=f"mode must be one of {MODES}")

    review = review_code(req.code, mode=req.mode, stderr=req.stderr)
    return {
        "mode": review.mode,
        "score": review.score,
        "issue_count": review.issue_count,
        "issues": [
            {"code": i.code, "message": i.message, "line": i.line} for i in review.issues
        ],
        "explanation": review.explanation,
        # Present only in assist mode, and only when there is something to fix.
        "corrected_code": review.corrected_code,
        "follow_up_question": review.follow_up_question,
    }


@app.post("/v1/webhooks/verify")
async def verify_webhook(request: Request) -> dict:
    """Echo whether a signature is valid. Useful for integration tests."""
    from .webhooks import verify

    raw = (await request.body()).decode("utf-8")
    signature = request.headers.get("x-tenxlab-signature-256")
    return {"valid": verify(WEBHOOK_SECRET, raw, signature)}
