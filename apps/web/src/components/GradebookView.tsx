'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api, ApiError, type BatchSummary, type Gradebook } from '@/lib/api';
import { gradebookRowSummary, gradebookCellLabel } from '@/lib/lms';

/**
 * Instructor gradebook — pick a batch and see every enrolled student against the
 * course's lessons, with the score each lab landed and a completion summary.
 * Scores arrive from the lab webhook, so this view is read-only by design.
 */
export function GradebookView() {
  const params = useSearchParams();
  const requested = params.get('batch');

  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [batchId, setBatchId] = useState<string | null>(requested);
  const [gradebook, setGradebook] = useState<Gradebook | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .batches()
      .then((b) => {
        setBatches(b);
        setBatchId((current) => current ?? b[0]?.id ?? null);
      })
      .catch((err) => {
        setError(
          err instanceof ApiError && err.status === 403
            ? 'The gradebook is available to instructors and admins.'
            : 'Could not load batches. Please try again.',
        );
      })
      .finally(() => setLoading(false));
  }, []);

  const loadGradebook = useCallback(async (id: string) => {
    setGradebook(null);
    try {
      setGradebook(await api.gradebook(id));
    } catch {
      setError('Could not load the gradebook for this batch.');
    }
  }, []);

  useEffect(() => {
    if (batchId) void loadGradebook(batchId);
  }, [batchId, loadGradebook]);

  if (loading) return <p className="muted">Loading gradebook…</p>;
  if (error) return <p className="error">{error}</p>;

  if (batches.length === 0) {
    return (
      <div>
        <h1>Gradebook</h1>
        <p className="muted">
          No batches yet. <Link href="/batches">Create a batch</Link> to start
          tracking student progress.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="row">
        <h1 style={{ marginBottom: 0 }}>Gradebook</h1>
        <select
          aria-label="Select batch"
          value={batchId ?? ''}
          onChange={(e) => setBatchId(e.target.value)}
          style={{ width: 'auto', minWidth: 220 }}
        >
          {batches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name} ({b.studentCount})
            </option>
          ))}
        </select>
      </div>
      <p className="muted" style={{ maxWidth: 640 }}>
        Scores land automatically from the lab grader. Use this view to see who
        has completed each lesson and what they scored.
      </p>

      {!gradebook ? (
        <p className="muted">Loading roster…</p>
      ) : gradebook.rows.length === 0 ? (
        <p className="muted">No students are enrolled in this batch yet.</p>
      ) : (
        <GradebookTable gradebook={gradebook} />
      )}
    </div>
  );
}

function GradebookTable({ gradebook }: { gradebook: Gradebook }) {
  return (
    <div className="card" style={{ marginTop: 16, overflowX: 'auto' }}>
      <table className="gradebook">
        <thead>
          <tr>
            <th scope="col">Student</th>
            {gradebook.lessons.map((lesson) => (
              <th scope="col" key={lesson.id}>
                {lesson.title}
              </th>
            ))}
            <th scope="col">Progress</th>
          </tr>
        </thead>
        <tbody>
          {gradebook.rows.map((row) => (
            <tr key={row.userId}>
              <th scope="row" style={{ textAlign: 'left' }}>
                {row.fullName}
                <span className="muted" style={{ display: 'block', fontWeight: 400 }}>
                  {row.email}
                </span>
              </th>
              {row.cells.map((cell) => (
                <td key={cell.lessonId}>
                  <span
                    className={`pill ${cell.score != null ? 'complete' : cell.status}`}
                  >
                    {gradebookCellLabel(cell)}
                  </span>
                </td>
              ))}
              <td className="muted">{gradebookRowSummary(row)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
