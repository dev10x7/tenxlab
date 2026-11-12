'use client';

import { useEffect, useState } from 'react';
import { api, ApiError, type LessonDetail } from '@/lib/api';
import { lessonStatusLabel } from '@/lib/lms';
import { HintReveal } from '@/components/HintReveal';

/**
 * Lesson viewer — a reading/video lesson's text, or the launch pad for a quiz
 * or interactive lab. Reached from the course page's "Open lesson".
 */
export default function LessonPage({
  params,
}: {
  params: { slug: string; lessonId: string };
}) {
  const [lesson, setLesson] = useState<LessonDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .lesson(params.slug, params.lessonId)
      .then(setLesson)
      .catch((err) =>
        setError(
          err instanceof ApiError && err.status === 401
            ? 'Sign in to view this lesson.'
            : 'Could not load this lesson.',
        ),
      );
  }, [params.slug, params.lessonId]);

  if (error) return <p className="error">{error}</p>;
  if (!lesson) return <p className="muted">Loading lesson…</p>;

  return (
    <div style={{ maxWidth: 760 }}>
      <p className="muted" style={{ marginBottom: 4 }}>
        <a href={`/courses/${lesson.courseSlug}`}>← {lesson.courseTitle}</a>
      </p>
      <div className="row">
        <h1 style={{ marginBottom: 4 }}>{lesson.title}</h1>
        <span className={`pill ${lesson.status}`}>
          {lessonStatusLabel(lesson.status, lesson.score)}
        </span>
      </div>
      <p className="muted" style={{ textTransform: 'capitalize' }}>
        {lesson.kind}
      </p>

      {lesson.body ? (
        <div style={{ marginTop: 16 }}>
          {lesson.body.split('\n\n').map((paragraph, index) => (
            <p key={index} style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
              {paragraph}
            </p>
          ))}
        </div>
      ) : null}

      {lesson.kind === 'lab' ? (
        <p className="muted">
          This lesson is a hands-on lab. Launch it from the{' '}
          <a href="/labs">Labs</a> page or the course page.
        </p>
      ) : null}

      {lesson.kind === 'quiz' ? (
        <p>
          <a className="btn" href="/assessments">
            Open the assessment
          </a>
        </p>
      ) : null}

      {lesson.hint ? <HintReveal hint={lesson.hint} /> : null}
    </div>
  );
}
