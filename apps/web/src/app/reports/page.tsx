'use client';

import { useEffect, useState } from 'react';
import { api, type BatchReport, type BatchReportDetail } from '@/lib/api';
import { scoreLabel } from '@/lib/lms';

/**
 * Student Reports — cohort analytics (ByteXL parity §2.10).
 *
 * A trainer sees every batch's roll-up (completion, average score, attendance,
 * and pending submissions) and can drill into one batch for its per-student
 * rows. Every number is rolled from the same tables the gradebook and the
 * attendance board read, so nothing drifts.
 */
export default function ReportsPage() {
  const [role, setRole] = useState<'student' | 'instructor' | 'admin' | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api
      .session()
      .then((s) => setRole(s?.role ?? null))
      .catch(() => setRole(null))
      .finally(() => setLoaded(true));
  }, []);

  if (!loaded) return <p className="muted">Loading reports…</p>;
  if (!role) return <p className="error">Please sign in to view reports.</p>;
  if (role === 'student') {
    return (
      <div>
        <h1>Student Reports</h1>
        <p className="muted">
          Cohort analytics are available to instructors and admins.
        </p>
      </div>
    );
  }

  return <ReportsView />;
}

function ReportsView() {
  const [reports, setReports] = useState<BatchReport[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<BatchReportDetail | null>(null);

  useEffect(() => {
    api
      .batchReports()
      .then(setReports)
      .catch(() => setError('Could not load reports. Please try again.'));
  }, []);

  const openBatch = async (batchId: string) => {
    setError(null);
    try {
      setSelected(await api.batchReport(batchId));
    } catch {
      setError('Could not load that batch.');
    }
  };

  return (
    <div>
      <h1>Student Reports</h1>
      <p className="muted" style={{ maxWidth: 640 }}>
        Cohort-level analytics for each batch: completion, average score,
        attendance, and submissions awaiting your review.
      </p>

      {error ? <p className="error">{error}</p> : null}
      {reports === null && !error ? <p className="muted">Loading reports…</p> : null}

      {reports && reports.length === 0 ? (
        <p className="muted">No batches yet.</p>
      ) : null}

      {reports && reports.length > 0 ? (
        <table className="gradebook" style={{ marginTop: 16 }}>
          <thead>
            <tr>
              <th>Batch</th>
              <th>Students</th>
              <th>Avg completion</th>
              <th>Avg score</th>
              <th>Attendance</th>
              <th>Pending</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {reports.map((r) => (
              <tr key={r.batchId}>
                <td>{r.batchName}</td>
                <td>{r.studentCount}</td>
                <td>{scoreLabel(r.avgCompletion)}</td>
                <td>{scoreLabel(r.avgScore)}</td>
                <td>{scoreLabel(r.attendancePercent)}</td>
                <td>{r.pendingSubmissions}</td>
                <td>
                  <button onClick={() => openBatch(r.batchId)}>View</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}

      {selected ? <BatchDetail detail={selected} /> : null}
    </div>
  );
}

function BatchDetail({ detail }: { detail: BatchReportDetail }) {
  const { report, rows } = detail;
  return (
    <section style={{ marginTop: 32 }}>
      <h2>{report.batchName} — students</h2>
      {rows.length === 0 ? (
        <p className="muted">No students on this batch yet.</p>
      ) : (
        <table className="gradebook">
          <thead>
            <tr>
              <th>Student</th>
              <th>Lessons</th>
              <th>Completion</th>
              <th>Avg score</th>
              <th>Attendance</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.userId}>
                <td>
                  {row.fullName}
                  <div className="muted" style={{ fontSize: 12 }}>
                    {row.email}
                  </div>
                </td>
                <td>
                  {row.lessonsComplete}/{row.lessonsTotal}
                </td>
                <td>{scoreLabel(row.completion)}</td>
                <td>{scoreLabel(row.averageScore)}</td>
                <td>{scoreLabel(row.attendancePercent)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
