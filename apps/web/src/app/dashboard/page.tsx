'use client';

import { useEffect, useState } from 'react';
import { api, type CourseSummary } from '@/lib/api';
import { courseProgress } from '@/lib/lms';

export default function DashboardPage() {
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

  if (loading) return <p className="muted">Loading your dashboard…</p>;
  if (error) return <p className="error">{error}</p>;

  const allLessons = courses.flatMap((c) => c.lessons);
  const overall = courseProgress(allLessons);

  return (
    <div>
      <div className="row">
        <h1 style={{ marginBottom: 0 }}>Your dashboard</h1>
        <span className="pill">{overall}% complete</span>
      </div>
      <div className="progress" style={{ margin: '12px 0 24px' }}>
        <span style={{ width: `${overall}%` }} />
      </div>

      <div className="grid">
        {courses.map((course) => {
          const pct = courseProgress(course.lessons);
          return (
            <a key={course.slug} className="card" href={`/courses/${course.slug}`}>
              <h3 style={{ marginTop: 0 }}>{course.title}</h3>
              <p className="muted">{course.description}</p>
              <div className="progress">
                <span style={{ width: `${pct}%` }} />
              </div>
              <p className="muted" style={{ marginBottom: 0 }}>
                {pct}% complete · {course.lessons.length} lessons
              </p>
            </a>
          );
        })}
      </div>
    </div>
  );
}
