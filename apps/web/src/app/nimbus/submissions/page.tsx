'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, type StudentSubmissionView } from '@/lib/api';
import { submissionStatusLabel } from '@/lib/lms';

/**
 * Nimbus Submissions — the LMS side of the submission flow: every workspace the
 * student has submitted, with its trainer score, auto-evaluation, and feedback.
 * Projects are built in Nimbus and submitted here, mirroring ByteXL.
 */
export default function NimbusSubmissionsPage() {
  const [rows, setRows] = useState<StudentSubmissionView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .myProjectSubmissions()
      .then(setRows)
      .catch(() => setError('Could not load your submissions. Please try again.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="muted">Loading submissions…</p>;
  if (error) return <p className="error">{error}</p>;

  return (
    <div>
      <h1>Nimbus Submissions</h1>
      <p className="muted" style={{ maxWidth: 680 }}>
        Your submitted workspaces and their evaluation. Build in{' '}
        <Link href="/nimbus">Nimbus</Link>, stop the workspace, then submit it
        before the deadline for your trainer to score.
      </p>

      {rows.length === 0 ? (
        <p className="muted">
          You have not submitted a project yet.{' '}
          <Link href="/nimbus">Go to your projects →</Link>
        </p>
      ) : (
        <div className="grid" style={{ marginTop: 16 }}>
          {rows.map(({ submission, workspace }) => (
            <div key={submission.id} className="card">
              <div className="row">
                <h3 style={{ margin: 0 }}>{submission.title}</h3>
                <span className="pill">{submissionStatusLabel(submission)}</span>
              </div>
              <p className="muted" style={{ marginBottom: 0 }}>
                {submission.description || 'No description.'}
              </p>
              <p className="muted" style={{ marginBottom: 0 }}>
                Submitted {new Date(submission.submittedAt).toLocaleDateString()}
                {submission.score != null ? ` · Score ${submission.score}` : ''}
                {submission.autoScore != null
                  ? ` · Auto-evaluation ${submission.autoScore}/100`
                  : ''}
              </p>
              {submission.feedback ? (
                <p className="muted" style={{ marginBottom: 0 }}>
                  Trainer feedback: {submission.feedback}
                </p>
              ) : null}
              {workspace ? (
                <p className="muted" style={{ marginBottom: 0 }}>
                  Workspace: {workspace.status}
                </p>
              ) : null}
              <div className="row" style={{ marginTop: 8 }}>
                {submission.githubUrl ? (
                  <a href={submission.githubUrl} target="_blank" rel="noreferrer">
                    GitHub →
                  </a>
                ) : null}
                {submission.demoUrl ? (
                  <a href={submission.demoUrl} target="_blank" rel="noreferrer">
                    Demo →
                  </a>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
