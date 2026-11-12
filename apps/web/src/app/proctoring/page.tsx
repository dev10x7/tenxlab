'use client';

import { useEffect, useState } from 'react';
import { api, ApiError, type ProctoredAttemptRow, type ProctorSummary } from '@/lib/api';
import { riskSummaryLabel } from '@/lib/lms';

/**
 * Proctoring — the instructor integrity view.
 *
 * Lists every graded attempt in the instructor's tenant with its aggregated
 * risk score. Signals are advisory: the page shows what the browser reported so
 * a human can decide, and never labels a student a cheater on its own.
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
    </div>
  );
}
