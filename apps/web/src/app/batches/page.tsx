'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  api,
  ApiError,
  type BatchSummary,
  type CourseSummary,
  type RosterEntry,
} from '@/lib/api';

/**
 * Batch management — the instructor/admin surface for cohorts: create a batch,
 * assign students to a course, and jump into that batch's gradebook. Reads are
 * tenant-scoped by the API; a student who reaches this page sees a permission
 * error rather than another cohort's roster.
 */
export default function BatchesPage() {
  const [batches, setBatches] = useState<BatchSummary[]>([]);
  const [courses, setCourses] = useState<CourseSummary[]>([]);
  const [students, setStudents] = useState<RosterEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [b, c, s] = await Promise.all([
      api.batches(),
      api.courses(),
      api.students(),
    ]);
    setBatches(b);
    setCourses(c);
    setStudents(s);
  }, []);

  useEffect(() => {
    load()
      .catch((err) => {
        setError(
          err instanceof ApiError && err.status === 403
            ? 'Batch management is available to instructors and admins.'
            : 'Could not load batches. Please try again.',
        );
      })
      .finally(() => setLoading(false));
  }, [load]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    try {
      await api.createBatch(name);
      setNewName('');
      setNotice(`Batch "${name}" created.`);
      await load();
    } catch {
      setError('Could not create the batch.');
    } finally {
      setBusy(false);
    }
  }

  async function onAssign(batchId: string, userId: string, courseId: string) {
    setBusy(true);
    setError(null);
    try {
      await api.assignStudent(batchId, userId, courseId);
      setNotice('Student assigned.');
      await load();
    } catch {
      setError('Could not assign the student.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="muted">Loading batches…</p>;

  const defaultCourseId = courses[0]?.id ?? '';

  return (
    <div>
      <h1>Batches</h1>
      <p className="muted" style={{ maxWidth: 640 }}>
        Manage student cohorts: create a batch, assign learners to a course, and
        open the gradebook to see how they are doing.
      </p>

      {error ? <p className="error">{error}</p> : null}
      {notice ? <p className="muted">{notice}</p> : null}

      <div className="card" style={{ marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>Create a batch</h3>
        <form className="row" style={{ gap: 12, alignItems: 'flex-end' }} onSubmit={onCreate}>
          <div style={{ flex: 1 }}>
            <label htmlFor="batch-name">Batch name</label>
            <input
              id="batch-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. CSE 2026 — Semester 1"
            />
          </div>
          <button className="btn" type="submit" disabled={busy || !newName.trim()}>
            Create batch
          </button>
        </form>
      </div>

      <h2 style={{ marginTop: 32 }}>Your batches</h2>
      {batches.length === 0 ? (
        <p className="muted">No batches yet. Create one above to get started.</p>
      ) : (
        <div className="grid">
          {batches.map((batch) => (
            <div key={batch.id} className="card">
              <div className="row">
                <h3 style={{ margin: 0 }}>{batch.name}</h3>
                <span className="pill">{batch.studentCount} students</span>
              </div>
              <p className="muted" style={{ marginBottom: 12 }}>
                <Link href={`/grading?batch=${encodeURIComponent(batch.id)}`}>
                  Open gradebook →
                </Link>
              </p>

              {students.length > 0 && defaultCourseId ? (
                <AssignForm
                  students={students}
                  disabled={busy}
                  onAssign={(userId) => onAssign(batch.id, userId, defaultCourseId)}
                />
              ) : (
                <p className="muted" style={{ marginBottom: 0 }}>
                  No students to assign yet.
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function AssignForm({
  students,
  disabled,
  onAssign,
}: {
  students: RosterEntry[];
  disabled: boolean;
  onAssign: (userId: string) => void;
}) {
  const [userId, setUserId] = useState(students[0]?.userId ?? '');
  return (
    <div>
      <label htmlFor="assign-student">Assign a student</label>
      <div className="row" style={{ gap: 8 }}>
        <select
          id="assign-student"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
        >
          {students.map((s) => (
            <option key={s.userId} value={s.userId}>
              {s.fullName} ({s.email})
            </option>
          ))}
        </select>
        <button
          className="btn secondary"
          type="button"
          disabled={disabled || !userId}
          onClick={() => onAssign(userId)}
        >
          Assign
        </button>
      </div>
    </div>
  );
}
