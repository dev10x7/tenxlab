'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  api,
  ApiError,
  type AttendanceStatus,
  type BatchAttendance,
  type BatchSummary,
  type StudentAttendance,
} from '@/lib/api';
import {
  attendancePercentLabel,
  attendanceStatusClass,
  attendanceStatusLabel,
} from '@/lib/lms';

const STATUS_OPTIONS: AttendanceStatus[] = ['present', 'absent', 'late', 'excused'];

/**
 * Classes — the attendance surface (ByteXL parity §2.9). A student sees their
 * own overall percentage and a per-session breakdown; a trainer schedules class
 * sessions and records each student's presence in a cohort matrix. The role
 * decides which view renders; the API enforces the same split.
 */
export default function ClassesPage() {
  const [role, setRole] = useState<'student' | 'instructor' | 'admin' | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api
      .session()
      .then((s) => setRole(s?.role ?? null))
      .catch(() => setRole(null))
      .finally(() => setLoaded(true));
  }, []);

  if (!loaded) return <p className="muted">Loading attendance…</p>;
  if (!role) return <p className="error">Please sign in to view your classes.</p>;

  return role === 'student' ? <StudentAttendanceView /> : <TrainerAttendanceView />;
}

// ------------------------------------------------------------------ student

function StudentAttendanceView() {
  const [view, setView] = useState<StudentAttendance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .myAttendance()
      .then(setView)
      .catch(() => setError('Could not load your attendance. Please try again.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="muted">Loading attendance…</p>;

  return (
    <div>
      <h1>Classes</h1>
      <p className="muted" style={{ maxWidth: 640 }}>
        Your class timetable and attendance. Present and late both count as
        attended; excused sessions are left out of the percentage.
      </p>

      {error ? <p className="error">{error}</p> : null}

      {view ? (
        <>
          <div className="card" style={{ marginTop: 16 }}>
            <h3 style={{ marginTop: 0 }}>Overall attendance</h3>
            <p style={{ marginBottom: 8 }}>
              <strong>{attendancePercentLabel(view.overall.percent)}</strong>
            </p>
            <div className="progress">
              <span style={{ width: `${Math.min(100, view.overall.percent)}%` }} />
            </div>
            <p className="muted" style={{ marginTop: 8, marginBottom: 0 }}>
              {view.overall.counts.present} present · {view.overall.counts.late} late
              · {view.overall.counts.absent} absent · {view.overall.counts.excused}{' '}
              excused
            </p>
          </div>

          <h2 style={{ marginTop: 32 }}>Sessions</h2>
          {view.sessions.length === 0 ? (
            <p className="muted">
              No sessions have been scheduled for your batches yet.
            </p>
          ) : (
            <table className="gradebook">
              <thead>
                <tr>
                  <th>Session</th>
                  <th>Date</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {view.sessions.map((s) => (
                  <tr key={s.sessionId}>
                    <td>{s.title}</td>
                    <td className="muted">{formatDate(s.scheduledAt)}</td>
                    <td>
                      <span className={`pill ${attendanceStatusClass(s.status)}`}>
                        {attendanceStatusLabel(s.status)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ trainer

function TrainerAttendanceView() {
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .batches()
      .then((list) => {
        setBatches(list);
        setSelected(list[0]?.id ?? null);
      })
      .catch((err) => {
        setError(
          err instanceof ApiError && err.status === 403
            ? 'Attendance is available to instructors and admins.'
            : 'Could not load batches. Please try again.',
        );
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="muted">Loading classes…</p>;

  return (
    <div>
      <h1>Classes</h1>
      <p className="muted" style={{ maxWidth: 640 }}>
        Schedule class sessions for a batch and record attendance. Present and
        late count as attended; excused sessions are left out of a student&apos;s
        percentage.
      </p>

      {error ? <p className="error">{error}</p> : null}

      {batches.length === 0 ? (
        <p className="muted" style={{ marginTop: 16 }}>
          No batches yet. <Link href="/batches">Create a batch →</Link>
        </p>
      ) : (
        <>
          <div className="card" style={{ marginTop: 16 }}>
            <label htmlFor="attendance-batch">Batch</label>
            <select
              id="attendance-batch"
              value={selected ?? ''}
              onChange={(e) => setSelected(e.target.value)}
            >
              {batches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
          {selected ? <BatchAttendanceBoard batchId={selected} /> : null}
        </>
      )}
    </div>
  );
}

function BatchAttendanceBoard({ batchId }: { batchId: string }) {
  const [view, setView] = useState<BatchAttendance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setView(await api.batchAttendance(batchId));
  }, [batchId]);

  useEffect(() => {
    setLoading(true);
    load()
      .catch(() => setError('Could not load attendance. Please try again.'))
      .finally(() => setLoading(false));
  }, [load]);

  async function mark(sessionId: string, userId: string, status: AttendanceStatus) {
    setError(null);
    try {
      await api.markAttendance(sessionId, userId, status);
      await load();
    } catch {
      setError('Could not record attendance. Please try again.');
    }
  }

  if (loading) return <p className="muted">Loading attendance…</p>;

  return (
    <div style={{ marginTop: 24 }}>
      <NewSessionForm batchId={batchId} onCreated={load} />

      <h2 style={{ marginTop: 24 }}>Attendance matrix</h2>
      {error ? <p className="error">{error}</p> : null}
      {!view || view.sessions.length === 0 ? (
        <p className="muted">No sessions yet. Schedule one above.</p>
      ) : view.rows.length === 0 ? (
        <p className="muted">No students are assigned to this batch yet.</p>
      ) : (
        <table className="gradebook">
          <thead>
            <tr>
              <th>Student</th>
              {view.sessions.map((s) => (
                <th key={s.id} title={formatDate(s.scheduledAt)}>
                  {s.title}
                </th>
              ))}
              <th>Overall</th>
            </tr>
          </thead>
          <tbody>
            {view.rows.map((row) => (
              <tr key={row.userId}>
                <td>
                  {row.fullName}
                  <br />
                  <span className="muted">{row.email}</span>
                </td>
                {row.cells.map((cell) => (
                  <td key={cell.sessionId}>
                    <select
                      aria-label={`${row.fullName} attendance`}
                      value={cell.status}
                      onChange={(e) =>
                        mark(cell.sessionId, row.userId, e.target.value as AttendanceStatus)
                      }
                    >
                      <option value="not_marked">Not marked</option>
                      {STATUS_OPTIONS.map((s) => (
                        <option key={s} value={s}>
                          {attendanceStatusLabel(s)}
                        </option>
                      ))}
                    </select>
                  </td>
                ))}
                <td>
                  <span className={`pill ${row.percent < 75 ? 'expired' : 'complete'}`}>
                    {row.percent}%
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function NewSessionForm({
  batchId,
  onCreated,
}: {
  batchId: string;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState('');
  const [scheduledAt, setScheduledAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !scheduledAt) return;
    setBusy(true);
    setError(null);
    try {
      await api.createClassSession(batchId, {
        title: title.trim(),
        scheduledAt: new Date(scheduledAt).toISOString(),
      });
      setTitle('');
      setScheduledAt('');
      onCreated();
    } catch {
      setError('Could not schedule the session.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Schedule a session</h3>
      <form onSubmit={create}>
        <label htmlFor="session-title">Title</label>
        <input
          id="session-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Week 3 — Kubernetes basics"
        />
        <label htmlFor="session-date">Date and time</label>
        <input
          id="session-date"
          type="datetime-local"
          value={scheduledAt}
          onChange={(e) => setScheduledAt(e.target.value)}
        />
        {error ? <p className="error">{error}</p> : null}
        <button
          className="btn"
          type="submit"
          disabled={busy || !title.trim() || !scheduledAt}
        >
          Add session
        </button>
      </form>
    </div>
  );
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}
