'use client';

import { useEffect, useState } from 'react';
import { api, type CourseSummary } from '@/lib/api';
import { lessonStatusLabel, courseProgress } from '@/lib/lms';
import { LabLaunchButton } from '@/components/LabLaunchButton';

export default function CoursePage({ params }: { params: { slug: string } }) {
  const [course, setCourse] = useState<CourseSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .course(params.slug)
      .then(setCourse)
      .catch(() => setError('Could not load this course.'));
  }, [params.slug]);

  if (error) return <p className="error">{error}</p>;
  if (!course) return <p className="muted">Loading course…</p>;

  const pct = courseProgress(course.lessons);

  return (
    <div>
      <h1 style={{ marginBottom: 4 }}>{course.title}</h1>
      <p className="muted">{course.description}</p>
      <div className="progress" style={{ margin: '12px 0 24px' }}>
        <span style={{ width: `${pct}%` }} />
      </div>

      <div className="grid">
        {course.lessons.map((lesson) => (
          <div key={lesson.id} className="card">
            <div className="row">
              <h3 style={{ margin: 0 }}>{lesson.title}</h3>
              <span className={`pill ${lesson.status}`}>
                {lessonStatusLabel(lesson.status, lesson.score)}
              </span>
            </div>
            <p className="muted" style={{ textTransform: 'capitalize' }}>
              {lesson.kind}
            </p>
            {lesson.kind === 'lab' ? (
              <LabLaunchButton lessonId={lesson.id} />
            ) : (
              <a
                className="btn secondary"
                href={`/courses/${course.slug}/lessons/${lesson.id}`}
              >
                Open lesson
              </a>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
