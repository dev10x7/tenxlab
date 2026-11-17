'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, type Session, type StudentDashboard } from '@/lib/api';
import { projectDeadlineLabel, rankPercentileLabel } from '@/lib/lms';

/**
 * Student dashboard — mirrors ByteXL's three-panel layout: the global header
 * (in the app shell), a main column of industry roadmaps and competitive
 * rankings, and a right rail with the profile-completion nudge that drives
 * recruiter visibility.
 */
export default function DashboardPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [view, setView] = useState<StudentDashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const s = await api.session();
        if (!active) return;
        setSession(s);
        if (s?.role !== 'student') return;
        setView(await api.dashboard());
      } catch {
        if (active) setError('Could not load your dashboard. Please try again.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  if (loading) return <p className="muted">Loading your dashboard…</p>;
  if (error) return <p className="error">{error}</p>;
  if (!session) return <p className="error">Please sign in to view your dashboard.</p>;

  // The aggregated dashboard is the student's view; staff land on their own
  // surfaces instead of a 403 from the student-only endpoint.
  if (session.role !== 'student') {
    const href = session.role === 'instructor' ? '/grading' : '/admin/users';
    return (
      <div>
        <h1>Hi, {session.displayName}</h1>
        <p className="muted">
          The student dashboard is the learner's view.{' '}
          <Link href={href}>Go to your {session.role} home →</Link>
        </p>
      </div>
    );
  }

  if (!view) return null;

  return (
    <div>
      <div className="row">
        <div>
          <h1 style={{ marginBottom: 0 }}>Hi, {view.studentName}</h1>
          <p className="muted" style={{ margin: 0 }}>
            Your industry roadmaps, standing, and profile at a glance.
          </p>
        </div>
      </div>

      <div className="dashboard-layout" style={{ marginTop: 20 }}>
        <div>
          {view.resume ? (
            <div className="card" style={{ marginBottom: 20 }}>
              <div className="row">
                <h3 style={{ margin: 0 }}>Resume learning</h3>
                <span className="pill">{view.resume.progress}%</span>
              </div>
              <p className="muted" style={{ marginBottom: 8 }}>
                {view.resume.courseTitle}
              </p>
              <Link className="btn" href={view.resume.href}>
                Continue: {view.resume.lessonTitle} →
              </Link>
            </div>
          ) : null}

          {view.upNext.length > 0 ? (
            <>
              <h2 style={{ marginTop: 0 }}>Up next for you</h2>
              <div className="grid" style={{ marginBottom: 28 }}>
                {view.upNext.map((item) => (
                  <Link
                    key={`${item.kind}-${item.id}`}
                    className="card"
                    href={item.href}
                  >
                    <div className="row">
                      <h3 style={{ margin: 0 }}>{item.title}</h3>
                      <span className="pill">
                        {item.kind === 'project' ? 'Project' : 'Assessment'}
                      </span>
                    </div>
                    <p className="muted" style={{ marginBottom: 0 }}>
                      {item.detail}
                      {item.dueAt ? ` · ${projectDeadlineLabel(item.dueAt)}` : ''}
                    </p>
                  </Link>
                ))}
              </div>
            </>
          ) : null}

          <h2 style={{ marginTop: view.upNext.length > 0 ? 0 : undefined }}>
            Industry roadmaps
          </h2>
          {view.roadmaps.length === 0 ? (
            <p className="muted">
              You are not enrolled in a course yet.{' '}
              <Link href="/catalog">Browse the catalog →</Link>
            </p>
          ) : (
            <div className="grid">
              {view.roadmaps.map((roadmap) => (
                <Link
                  key={roadmap.courseId}
                  className="card"
                  href={`/courses/${roadmap.slug}`}
                >
                  <h3 style={{ marginTop: 0 }}>{roadmap.title}</h3>
                  <div className="progress">
                    <span style={{ width: `${roadmap.progress}%` }} />
                  </div>
                  <p className="muted" style={{ marginBottom: 0 }}>
                    {roadmap.progress}% complete · {roadmap.lessonsComplete}/
                    {roadmap.lessonsTotal} lessons
                  </p>
                </Link>
              ))}
            </div>
          )}

          <h2 style={{ marginTop: 28 }}>Your standing</h2>
          {view.rankings.length === 0 ? (
            <p className="muted">No rankings yet.</p>
          ) : (
            <div className="grid">
              {view.rankings.map((rank) => (
                <div key={rank.scope} className="rank-tile">
                  <span className="rank-badge">#{rank.rank}</span>
                  <div>
                    <strong>{rank.label}</strong>
                    <p className="muted" style={{ margin: 0 }}>
                      {rank.rank} of {rank.total} · {rankPercentileLabel(rank.percentile)}
                      {rank.averageScore != null
                        ? ` · avg ${rank.averageScore}%`
                        : ''}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <aside>
          <div className="card">
            <h3 style={{ marginTop: 0 }}>Profile completion</h3>
            <div className="profile-ring">
              <span className="profile-ring-figure">{view.profile.percent}%</span>
              <p className="muted" style={{ margin: 0 }}>
                Complete your profile to become discoverable by recruiters.
              </p>
            </div>
            <ul className="checklist">
              {view.profile.items.map((item) => (
                <li key={item.key} className={item.done ? 'done' : undefined}>
                  <span className="check" aria-hidden>
                    {item.done ? '✓' : '○'}
                  </span>
                  <span>{item.label}</span>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </div>
  );
}
