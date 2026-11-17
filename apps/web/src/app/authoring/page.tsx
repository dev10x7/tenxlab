'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError, type CourseEditor } from '@/lib/api';

/**
 * Authoring — the instructor's course list. Unlike the catalog, drafts are
 * visible here, so an instructor can build a course, publish it, and pull it
 * back to draft. The API gates every call on the `course:write` capability.
 */
export default function AuthoringPage() {
  const [courses, setCourses] = useState<CourseEditor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setCourses(await api.authoringCourses());
  }, []);

  useEffect(() => {
    load()
      .catch((err) => {
        setError(
          err instanceof ApiError && err.status === 403
            ? 'Course authoring is available to instructors and admins.'
            : 'Could not load your courses. Please try again.',
        );
      })
      .finally(() => setLoading(false));
  }, [load]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.createCourse({ title: title.trim(), description: description.trim() });
      setTitle('');
      setDescription('');
      await load();
    } catch {
      setError('Could not create the course.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="muted">Loading your courses…</p>;

  return (
    <div>
      <h1>Authoring</h1>
      <p className="muted" style={{ maxWidth: 640 }}>
        Build courses as chapters of lessons, then publish them to your cohorts.
        Drafts stay hidden from students until you publish.
      </p>

      {error ? <p className="error">{error}</p> : null}

      <div className="card" style={{ marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>New course</h3>
        <form onSubmit={onCreate}>
          <div className="row" style={{ gap: 12, alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <label htmlFor="course-title">Title</label>
              <input
                id="course-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Kubernetes Foundations"
              />
            </div>
            <button className="btn" type="submit" disabled={busy || !title.trim()}>
              Create course
            </button>
          </div>
          <div style={{ marginTop: 12 }}>
            <label htmlFor="course-description">Description</label>
            <input
              id="course-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="One line students will see in the catalog"
            />
          </div>
        </form>
      </div>

      <h2 style={{ marginTop: 32 }}>Your courses</h2>
      {courses.length === 0 ? (
        <p className="muted">No courses yet. Create one above to get started.</p>
      ) : (
        <div className="grid">
          {courses.map((course) => {
            const lessonCount = course.modules.reduce((n, m) => n + m.lessons.length, 0);
            return (
              <Link key={course.id} className="card" href={`/authoring/${course.id}`}>
                <div className="row">
                  <h3 style={{ margin: 0 }}>{course.title}</h3>
                  <span className={`pill ${course.status}`}>{course.status}</span>
                </div>
                <p className="muted">{course.description || 'No description yet.'}</p>
                <span className="pill">
                  {course.modules.length} chapters · {lessonCount} lessons
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
