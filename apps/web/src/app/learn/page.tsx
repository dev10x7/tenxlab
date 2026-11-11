'use client';

import { useEffect, useState } from 'react';
import { api, type CourseSummary } from '@/lib/api';
import { courseProgress } from '@/lib/lms';

/**
 * Learn — the structured-content view: every published course with the
 * student's progress, the entry point into a course's lessons.
 */
export default function LearnPage() {
  const [courses, setCourses] = useState<CourseSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .courses()
      .then(setCourses)
      .catch(() => setError('Could not load your courses. Please try again.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="muted">Loading courses…</p>;
  if (error) return <p className="error">{error}</p>;

  return (
    <div>
      <h1>Learn</h1>
      <p className="muted" style={{ maxWidth: 640 }}>
        Course content — videos, readings, and hands-on topics. Pick up where
        you left off.
      </p>

      <div className="grid" style={{ marginTop: 16 }}>
        {courses.map((course) => {
          const pct = courseProgress(course.lessons);
          return (
            <a key={course.slug} className="card" href={`/courses/${course.slug}`}>
              <div className="row">
                <h3 style={{ margin: 0 }}>{course.title}</h3>
                <span className="pill">{pct}%</span>
              </div>
              <p className="muted">{course.description}</p>
              <div className="progress">
                <span style={{ width: `${pct}%` }} />
              </div>
              <p className="muted" style={{ marginBottom: 0 }}>
                {course.lessons.length} lessons
              </p>
            </a>
          );
        })}
        {courses.length === 0 ? (
          <p className="muted">No courses are published yet.</p>
        ) : null}
      </div>
    </div>
  );
}
