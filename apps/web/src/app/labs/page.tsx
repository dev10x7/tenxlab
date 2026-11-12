'use client';

import { useEffect, useState } from 'react';
import { api, type CourseSummary, type LessonSummary } from '@/lib/api';
import { lessonStatusLabel } from '@/lib/lms';
import { LabLaunchButton } from '@/components/LabLaunchButton';
import { HintReveal } from '@/components/HintReveal';

interface LabLesson extends LessonSummary {
  courseSlug: string;
  courseTitle: string;
}

/**
 * Labs — ungraded, hands-on practice. Lists every `lab` lesson across the
 * student's courses and launches a real environment via the execution plane.
 */
export default function LabsPage() {
  const [labs, setLabs] = useState<LabLesson[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .courses()
      .then((courses: CourseSummary[]) =>
        setLabs(
          courses.flatMap((c) =>
            c.lessons
              .filter((l) => l.kind === 'lab')
              .map((l) => ({
                ...l,
                courseSlug: c.slug,
                courseTitle: c.title,
              })),
          ),
        ),
      )
      .catch(() => setError('Could not load your labs. Please try again.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="muted">Loading labs…</p>;
  if (error) return <p className="error">{error}</p>;

  return (
    <div>
      <h1>Labs</h1>
      <p className="muted" style={{ maxWidth: 640 }}>
        Practice without grading. Each lab spins up a real environment in the
        browser — create resources, experiment, and check your work.
      </p>

      <div className="grid" style={{ marginTop: 16 }}>
        {labs.map((lab) => (
          <div key={lab.id} className="card">
            <div className="row">
              <h3 style={{ margin: 0 }}>{lab.title}</h3>
              <span className={`pill ${lab.status}`}>
                {lessonStatusLabel(lab.status, lab.score)}
              </span>
            </div>
            <p className="muted">{lab.courseTitle}</p>
            <LabLaunchButton lessonId={lab.id} />
            {lab.hint ? <HintReveal hint={lab.hint} /> : null}
          </div>
        ))}
        {labs.length === 0 ? (
          <p className="muted">No labs are available yet.</p>
        ) : null}
      </div>
    </div>
  );
}
