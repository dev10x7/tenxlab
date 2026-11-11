'use client';

import { useEffect, useState } from 'react';
import { api, type CourseSummary } from '@/lib/api';

export default function CatalogPage() {
  const [courses, setCourses] = useState<CourseSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .courses()
      .then(setCourses)
      .catch(() => setError('Could not load the catalog. Please try again.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="muted">Loading catalog…</p>;
  if (error) return <p className="error">{error}</p>;

  return (
    <div>
      <h1>Course catalog</h1>
      <div className="grid">
        {courses.map((course) => (
          <a key={course.slug} className="card" href={`/courses/${course.slug}`}>
            <h3 style={{ marginTop: 0 }}>{course.title}</h3>
            <p className="muted">{course.description}</p>
            <span className="pill">{course.lessons.length} lessons</span>
          </a>
        ))}
        {courses.length === 0 ? (
          <p className="muted">No courses are published yet.</p>
        ) : null}
      </div>
    </div>
  );
}
