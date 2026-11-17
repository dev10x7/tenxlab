'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  api,
  ApiError,
  type IntegrityScan,
  type ProctoredAttemptRow,
  type ProctorSummary,
} from '@/lib/api';
import { riskSummaryLabel, similarityLabel } from '@/lib/lms';

/**
 * Proctoring — the instructor integrity view.
 *
 * Lists every graded attempt in the instructor's tenant with its aggregated
 * risk score, and offers a batch-scope code-similarity scan per assessment.
 * Signals are advisory: the page shows what the browser reported and which
 * submissions resemble each other so a human can decide, and never labels a
 * student a cheater on its own.
 */
export default function ProctoringPage() {
  const [rows, setRows] = useState<ProctoredAttemptRow[]>([]);
  const [selected, setSelected] = useState<ProctorSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .proctoredAttempts()
      .then(setRows)
      .catch((err) =>
        setError(
          err instanceof ApiError && err.status === 403
            ? 'Proctoring review is available to instructors and admins.'
            : 'Could not load proctoring data. Please try again.',
        ),
      )
      .finally(() => setLoading(false));
  }, []);

  async function open(attemptId: string) {
    try {
      setSelected(await api.proctorSummary(attemptId));
    } catch {
      setError('Could not load that attempt’s summary.');
    }
  }

  const assessments = useMemo(
    () => [...new Set(rows.map((r) => r.assessmentId))].sort(),
    [rows],
  );

  if (loading) return <p className="muted">Loading proctoring…</p>;

  return (
    <div>
      <h1>Proctoring</h1>
      <p className="muted" style={{ maxWidth: 640 }}>
        Exam integrity signals for graded attempts. Each row aggregates the
        browser-reported events (tab switches, copy/paste, fullscreen exits) into
        a risk score for review — never an automatic verdict.
      </p>

      {error ? <p className="error">{error}</p> : null}

      <div className="grid" style={{ marginTop: 16 }}>
        {rows.map((row) => (
          <div key={row.attemptId} className="card">
            <div className="row">
              <h3 style={{ margin: 0 }}>{row.assessmentId}</h3>
              <span className={`pill ${row.risk.riskLevel}`}>
                {riskSummaryLabel(row.risk)}
              </span>
            </div>
            <p className="muted">
              Attempt {row.attemptId} · {row.status}
              {row.score != null ? ` · scored ${row.score}` : ''} ·{' '}
              {new Date(row.startedAt).toLocaleString()}
            </p>
            <button type="button" className="btn secondary" onClick={() => void open(row.attemptId)}>
              View signals
            </button>
          </div>
        ))}
        {rows.length === 0 ? (
          <p className="muted">No graded attempts to review yet.</p>
        ) : null}
      </div>

      {selected ? (
        <div className="card" style={{ marginTop: 24 }}>
          <div className="row">
            <h3 style={{ margin: 0 }}>Signals — {selected.attemptId}</h3>
            <span className={`pill ${selected.riskLevel}`}>
              {riskSummaryLabel(selected)}
            </span>
          </div>
          <div style={{ marginTop: 8 }}>
            {Object.entries(selected.counts).map(([type, count]) => (
              <div key={type} className="result-row">
                <span>{type.replace(/_/g, ' ')}</span>
                <strong>{count}</strong>
              </div>
            ))}
            {selected.eventCount === 0 ? (
              <p className="muted">No signals recorded for this attempt.</p>
            ) : null}
          </div>
        </div>
      ) : null}

      <SimilarityScan assessments={assessments} />
    </div>
  );
}

/**
 * Batch-scope code-similarity scan (§4.2). An instructor picks a graded
 * assessment and scans the cohort's coding answers for near-duplicates; the AI
 * plane's rename-invariant fingerprint catches a renamed copy. Results are
 * advisory — candidate matches, never a verdict.
 */
function SimilarityScan({ assessments }: { assessments: string[] }) {
  const [assessmentId, setAssessmentId] = useState('');
  const [scan, setScan] = useState<IntegrityScan | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'unavailable'>('idle');

  const run = async () => {
    if (!assessmentId) return;
    setStatus('loading');
    setScan(null);
    try {
      setScan(await api.assessmentSimilarity(assessmentId));
      setStatus('idle');
    } catch (err) {
      setStatus(err instanceof ApiError && err.status === 503 ? 'unavailable' : 'idle');
      if (!(err instanceof ApiError && err.status === 503)) {
        setScan(null);
      }
    }
  };

  return (
    <section style={{ marginTop: 32 }}>
      <h2>Code similarity</h2>
      <p className="muted" style={{ maxWidth: 640 }}>
        Compare every student’s coding answers in a graded assessment for
        near-duplicates. Rename-invariant, so a copied submission with renamed
        variables is still flagged. Candidate matches only — review before acting.
      </p>

      <div className="row" style={{ gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <label>
          <div className="muted" style={{ fontSize: 12 }}>
            Assessment
          </div>
          <select
            value={assessmentId}
            onChange={(e) => setAssessmentId(e.target.value)}
          >
            <option value="">Select an assessment…</option>
            {assessments.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => void run()}
          disabled={!assessmentId || status === 'loading'}
        >
          {status === 'loading' ? 'Scanning…' : 'Scan for similarity'}
        </button>
      </div>

      {status === 'unavailable' ? (
        <p className="error">
          Code-similarity scanning needs the AI plane, which is not configured.
        </p>
      ) : null}

      {scan ? (
        <div style={{ marginTop: 16 }}>
          <p className="muted">
            Compared {scan.compared} submission(s) · {scan.flaggedCount} flagged at
            or above {similarityLabel(scan.threshold)} similarity.
          </p>
          {scan.results.length === 0 ? (
            <p className="muted">
              Nothing to compare yet — at least two students must have submitted
              coding answers.
            </p>
          ) : (
            <table className="gradebook">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Worst match</th>
                  <th>Resembles</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {scan.results.map((r) => (
                  <tr key={r.userId}>
                    <td>{r.studentName}</td>
                    <td>{similarityLabel(r.maxSimilarity)}</td>
                    <td>
                      {r.matches.length === 0
                        ? '—'
                        : r.matches
                            .slice(0, 3)
                            .map(
                              (m) =>
                                `${m.studentName} (${similarityLabel(m.similarity)})`,
                            )
                            .join(', ')}
                    </td>
                    <td>
                      <span className={`pill ${r.flagged ? 'high' : 'low'}`}>
                        {r.flagged ? 'Flagged' : 'OK'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ) : null}
    </section>
  );
}

