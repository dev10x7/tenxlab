import hashlib
import hmac as _hmac
import json

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.plagiarism import compare_against_cohort, normalize, similarity
from app.quality import score_quality
from app.speech import evaluate_speech
from app.tutor import clean_code, review_code, sanitize_source
from app.webhooks import sign, verify

client = TestClient(app)


# --------------------------------------------------------------- plagiarism


def test_identical_code_is_maximally_similar():
    code = "def add(a, b):\n    return a + b\n"
    assert similarity(code, code) == pytest.approx(1.0)


def test_renamed_variables_still_match():
    a = "def add(first, second):\n    return first + second\n"
    b = "def add(x, y):\n    return x + y\n"
    assert similarity(a, b) > 0.9


def test_comments_and_strings_are_ignored():
    a = 'def greet():\n    print("hello world")\n    return 1\n'
    b = 'def greet():\n    print("totally different text")\n    return 1\n'
    assert similarity(a, b) == pytest.approx(1.0)


def test_unrelated_code_scores_low():
    a = "def add(a, b):\n    return a + b\n"
    b = "class Tree:\n    def insert(self, node):\n        self.root = node\n"
    assert similarity(a, b) < 0.3


def test_normalize_alpha_renames_identifiers_and_numbers():
    tokens = normalize("total = compute(41)")
    assert tokens == ["ID1", "=", "ID2", "(", "NUM", ")"]
    # Order of first appearance is stable, so renames are invariant.
    assert normalize("x = f(1)") == normalize("y = g(2)")


def test_compare_against_cohort_flags_high_similarity():
    cohort = {
        "s1": "def add(a, b):\n    return a + b\n",
        "s2": "def add(x, y):\n    return x + y\n",
        "s3": "class Node:\n    pass\n",
    }
    report = compare_against_cohort("s1", cohort["s1"], cohort, threshold=0.75)
    assert report.flagged is True
    assert report.matches[0].student_id == "s2"


def test_plagiarism_endpoint_returns_results():
    resp = client.post(
        "/v1/plagiarism/score",
        json={
            "tenant_id": "t1",
            "exercise_id": "e1",
            "submissions": [
                {"student_id": "s1", "code": "def add(a, b):\n    return a + b\n"},
                {"student_id": "s2", "code": "def add(x, y):\n    return x + y\n"},
            ],
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["results"]) == 2
    assert body["results"][0]["flagged"] is True


def test_plagiarism_endpoint_rejects_empty_submissions():
    resp = client.post(
        "/v1/plagiarism/score",
        json={"tenant_id": "t1", "exercise_id": "e1", "submissions": []},
    )
    assert resp.status_code == 422


# ------------------------------------------------------------------- quality


def test_clean_code_scores_100():
    report = score_quality("def add(a, b):\n    return a + b\n")
    assert report.score == 100
    assert report.issue_count == 0


def test_todo_and_secret_are_penalised():
    code = 'api_key = "supersecret"\n# TODO: remove this\n'
    report = score_quality(code)
    codes = {i.code for i in report.issues}
    assert "todo-left" in codes
    assert "hardcoded-secret" in codes
    assert report.score < 100


def test_quality_endpoint_returns_score_and_issues():
    resp = client.post(
        "/v1/quality/score",
        json={
            "tenant_id": "t1",
            "project_id": "p1",
            "student_id": "s1",
            "code": "print('debug')\n",
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["score"] < 100
    assert body["issue_count"] >= 1


# -------------------------------------------------------------------- speech


def test_speech_scores_expected_terms():
    report = evaluate_speech(
        "A pod is the smallest deployable unit in kubernetes. "
        "Each pod runs one or more containers.",
        expected_terms=["pod", "kubernetes", "container"],
    )
    assert report.technical_accuracy == 100
    assert report.communication_score > 50


def test_speech_penalises_filler_words():
    clean = evaluate_speech("Kubernetes schedules pods onto nodes.")
    messy = evaluate_speech(
        "Um, so, like, basically kubernetes, you know, schedules, um, pods."
    )
    assert messy.filler_words < clean.filler_words


def test_speech_endpoint_returns_breakdown():
    resp = client.post(
        "/v1/speech/evaluate",
        json={
            "tenant_id": "t1",
            "student_id": "s1",
            "prompt_id": "explain-pods",
            "transcript": "A pod wraps one or more containers.",
            "expected_terms": ["pod", "container"],
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert set(body["breakdown"]) == {
        "grammar",
        "vocabulary",
        "filler_words",
        "technical_accuracy",
    }


# ------------------------------------------------------------------ tutor


def test_sanitize_source_strips_region_markers():
    src = "# start your solution\nprint(1)\n# end your solution\n"
    assert sanitize_source(src) == "print(1)"


def test_clean_code_strips_todo_and_trailing_whitespace():
    src = "# TODO: finish\nx = 1   \n# FIXME\nprint(x)\n"
    cleaned = clean_code(src)
    assert "TODO" not in cleaned and "FIXME" not in cleaned
    assert "x = 1\n" in cleaned
    assert cleaned.endswith("print(x)\n")


def test_socratic_mode_never_returns_corrected_code():
    review = review_code("# TODO: fix\nprint(1)", mode="socratic", stderr="SyntaxError: bad")
    assert review.corrected_code is None
    assert review.follow_up_question
    assert "parse" in review.explanation.lower()


def test_assist_mode_returns_corrected_code_when_there_is_a_fix():
    review = review_code("# TODO: fix\nprint(1)\n", mode="assist")
    assert review.corrected_code is not None
    assert "TODO" not in review.corrected_code


def test_assist_mode_omits_correction_when_code_is_clean():
    review = review_code("print(1)\n", mode="assist")
    assert review.corrected_code is None


def test_runtime_error_names_the_root_cause():
    review = review_code("int x = 1", mode="assist", stderr="error: ';' expected")
    assert "parse" in review.explanation.lower()


def test_unknown_mode_is_rejected():
    with pytest.raises(ValueError):
        review_code("print(1)", mode="cheat")


def test_tutor_endpoint_assist_returns_correction():
    resp = client.post(
        "/v1/tutor/review",
        json={"language": "python", "code": "# TODO: x\nprint(1)\n", "mode": "assist"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["mode"] == "assist"
    assert body["corrected_code"] is not None
    assert body["follow_up_question"] is None


def test_tutor_endpoint_socratic_returns_question_not_code():
    resp = client.post(
        "/v1/tutor/review",
        json={
            "language": "python",
            "code": "print(1)\n",
            "mode": "socratic",
            "stderr": "NameError: name 'y' is not defined",
        },
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["mode"] == "socratic"
    assert body["corrected_code"] is None
    assert body["follow_up_question"]


def test_tutor_endpoint_rejects_unknown_mode():
    resp = client.post(
        "/v1/tutor/review",
        json={"language": "python", "code": "print(1)", "mode": "leak"},
    )
    assert resp.status_code == 422


# ------------------------------------------------------------------ webhooks

def test_hmac_sign_and_verify_roundtrip():
    body = json.dumps({"hello": "world"})
    sig = sign("s3cret", body)
    assert verify("s3cret", body, sig) is True
    assert verify("s3cret", body, "deadbeef") is False
    assert verify("other", body, sig) is False
    assert verify("s3cret", body, None) is False


def test_signature_matches_typescript_implementation():
    # Known-answer test: this digest was produced by the Node implementation
    # (packages/contracts hmacSha256Hex). If they diverge, webhook verification
    # breaks across the Node and Python planes.
    body = '{"a":1}'
    expected = "37beaf650f70b40ec9706929c2e9d835cbd63729988f48781e6383a147215f07"
    assert sign("s", body) == expected
    # Also confirm the local hashlib path agrees (guards against a refactor).
    local = _hmac.new(b"s", body.encode(), hashlib.sha256).hexdigest()
    assert sign("s", body) == local


def test_verify_endpoint_reports_valid_signature():
    body = '{"a":1}'
    sig = sign("dev-webhook-secret", body)
    resp = client.post(
        "/v1/webhooks/verify",
        content=body,
        headers={"x-tenxlab-signature-256": sig, "content-type": "application/json"},
    )
    assert resp.status_code == 200
    assert resp.json()["valid"] is True


def test_healthz():
    resp = client.get("/healthz")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"
