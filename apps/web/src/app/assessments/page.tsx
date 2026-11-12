'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  api,
  ApiError,
  type AssessmentQuestion,
  type AssessmentView,
  type AttemptResult,
  type AttemptView,
} from '@/lib/api';
import { attemptClockLabel, clockUrgent } from '@/lib/lms';
import { CodeEditor } from '@/components/CodeEditor';
import { ProctorGuard } from '@/components/ProctorGuard';

/**
 * Assessments — graded tests with a server-owned timer and proctoring.
 *
 * The page has two modes. The list shows every assessment; picking one starts
 * (or resumes) a sitting. While a sitting is live the server owns the deadline:
 * the countdown is seeded from `remainingSeconds` and ticks locally, and the
 * submit is validated server-side so a tampered clock cannot extend the exam.
 * A proctored sitting mounts `ProctorGuard`, which reports integrity signals.
 */
export default function AssessmentsPage() {
  const [assessments, setAssessments] = useState<AssessmentView[]>([]);
  const [attempt, setAttempt] = useState<AttemptView | null>(null);
  const [answers, setAnswers] = useState<Record<string, string | number>>({});
  const [result, setResult] = useState<AttemptResult | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api
      .assessments()
      .then(setAssessments)
      .catch((err) =>
        setError(
          err instanceof ApiError && err.status === 401
            ? 'Sign in to take an assessment.'
            : 'Could not load assessments. Please try again.',
        ),
      )
      .finally(() => setLoading(false));
  }, []);

  const submit = useCallback(
    async (attemptId: string) => {
      setSubmitting(true);
      try {
        setResult(await api.submitAttempt(attemptId, answers));
        setAttempt(null);
        setRemaining(null);
      } catch {
        setError('Could not submit your attempt. Please try again.');
      } finally {
        setSubmitting(false);
      }
    },
    [answers],
  );

  // Tick the local clock down from the server-seeded remaining time. When it
  // reaches zero the attempt auto-submits; the server is the final authority.
  useEffect(() => {
    if (!attempt || remaining == null) return;
    if (remaining <= 0) {
      void submit(attempt.id);
      return;
    }
    const id = setInterval(() => setRemaining((r) => (r == null ? r : r - 1)), 1000);
    return () => clearInterval(id);
  }, [attempt, remaining, submit]);

  async function start(assessmentId: string) {
    setError(null);
    setResult(null);
    try {
      const started = await api.startAttempt(assessmentId);
      setAttempt(started);
      setRemaining(started.remainingSeconds);
      setAnswers(seedAnswers(started.assessment.questions));
    } catch {
      setError('Could not start this assessment. Please try again.');
    }
  }

  if (loading) return <p className="muted">Loading assessments…</p>;

  if (result) {
    return <ResultView result={result} onDone={() => setResult(null)} />;
  }

  if (attempt) {
    const a = attempt.assessment;
    return (
      <div>
        <div className="row">
          <h1 style={{ marginBottom: 0 }}>{a.title}</h1>
          <span className={`exam-clock${clockUrgent(remaining ?? 0) ? ' urgent' : ''}`}>
            {attemptClockLabel(remaining)}
          </span>
        </div>
        {a.proctored ? <ProctorGuard attemptId={attempt.id} /> : null}

        {a.questions.map((q) => (
          <QuestionField
            key={q.id}
            question={q}
            value={answers[q.id]}
            onChange={(v) => setAnswers((prev) => ({ ...prev, [q.id]: v }))}
          />
        ))}

        {error ? <p className="error">{error}</p> : null}
        <button
          type="button"
          className="btn"
          style={{ marginTop: 24 }}
          disabled={submitting}
          onClick={() => void submit(attempt.id)}
        >
          {submitting ? 'Submitting…' : 'Submit for grading'}
        </button>
      </div>
    );
  }

  return (
    <div>
      <h1>Assessments</h1>
      <p className="muted" style={{ maxWidth: 640 }}>
        Graded tests with a timer and proctoring. The server owns the clock, so a
        refresh never buys extra time; coding answers run against hidden tests.
      </p>

      {error ? <p className="error">{error}</p> : null}

      <div className="grid" style={{ marginTop: 16 }}>
        {assessments.map((a) => (
          <div key={a.id} className="card">
            <div className="row">
              <h3 style={{ margin: 0 }}>{a.title}</h3>
              <span className={`pill ${a.proctored ? 'in_progress' : 'complete'}`}>
                {a.proctored ? 'Proctored' : 'Practice'}
              </span>
            </div>
            <p className="muted">
              {a.questions.length} questions · {a.maxScore} points ·{' '}
              {a.durationSeconds == null
                ? 'untimed'
                : `${Math.round(a.durationSeconds / 60)} min`}
            </p>
            <button type="button" className="btn" onClick={() => void start(a.id)}>
              {a.mode === 'graded' ? 'Start test' : 'Start practice'}
            </button>
          </div>
        ))}
        {assessments.length === 0 ? (
          <p className="muted">No assessments are available yet.</p>
        ) : null}
      </div>
    </div>
  );
}

/** Pre-fill coding answers with their stub so the read-only region is present. */
function seedAnswers(
  questions: AssessmentQuestion[],
): Record<string, string | number> {
  const seed: Record<string, string | number> = {};
  for (const q of questions) {
    if (q.kind === 'coding' && q.stubCode) seed[q.id] = q.stubCode;
  }
  return seed;
}

function QuestionField({
  question,
  value,
  onChange,
}: {
  question: AssessmentQuestion;
  value: string | number | undefined;
  onChange: (value: string | number) => void;
}) {
  return (
    <div className="question">
      <div className="row">
        <strong>{question.prompt}</strong>
        <span className="muted">{question.maxScore} pts</span>
      </div>

      {question.kind === 'coding' ? (
        <div style={{ marginTop: 8 }}>
          {question.hasSolutionRegion ? (
            <p className="muted">
              The region between the markers is read-only; write your solution
              inside it.
            </p>
          ) : null}
          <CodeEditor
            value={String(value ?? '')}
            language="python"
            onChange={(v) => onChange(v)}
          />
        </div>
      ) : null}

      {question.kind === 'mcq' && question.options ? (
        <div style={{ marginTop: 8 }}>
          {question.options.map((opt, i) => (
            <label key={opt} style={{ display: 'block', margin: '4px 0' }}>
              <input
                type="radio"
                name={question.id}
                checked={value === i}
                onChange={() => onChange(i)}
                style={{ width: 'auto', marginRight: 8 }}
              />
              {opt}
            </label>
          ))}
        </div>
      ) : null}

      {question.kind === 'fill' ? (
        <input
          type="text"
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Your answer"
        />
      ) : null}

      {question.kind === 'descriptive' ? (
        <textarea
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          rows={5}
          style={{ width: '100%', marginTop: 8 }}
          placeholder="Write your answer"
        />
      ) : null}
    </div>
  );
}

function ResultView({
  result,
  onDone,
}: {
  result: AttemptResult;
  onDone: () => void;
}) {
  const pct = result.maxScore > 0 ? Math.round((result.score / result.maxScore) * 100) : 0;
  return (
    <div>
      <h1>Result</h1>
      <div className="row">
        <span className={`pill ${result.status === 'expired' ? 'expired' : 'complete'}`}>
          {result.status === 'expired' ? 'Expired' : 'Submitted'}
        </span>
        <span>
          {result.score} / {result.maxScore} ({pct}%)
        </span>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        {result.results.map((r) => (
          <div key={r.questionId} className="result-row">
            <span>
              {r.questionId} — {r.feedback}
            </span>
            <strong>
              {r.score}/{r.maxScore}
            </strong>
          </div>
        ))}
      </div>

      <button type="button" className="btn" style={{ marginTop: 16 }} onClick={onDone}>
        Back to assessments
      </button>
    </div>
  );
}
