'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  api,
  ApiError,
  type SupportCategory,
  type SupportIssue,
  type SupportStatus,
} from '@/lib/api';

const CATEGORIES: { value: SupportCategory; label: string }[] = [
  { value: 'bug', label: 'Bug' },
  { value: 'feature', label: 'Feature request' },
  { value: 'question', label: 'Question' },
  { value: 'other', label: 'Other' },
];

const STATUS_LABEL: Record<SupportStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  resolved: 'Resolved',
};

const NEXT_STATUS: SupportStatus[] = ['open', 'in_progress', 'resolved'];

/**
 * Support — the Report-an-Issue surface (ByteXL parity §2.11).
 *
 * Any signed-in member can file a report; the page they were on is captured
 * automatically so a reproduction is never a follow-up question. Instructors
 * and admins also get the tenant's queue, where they can move issues through
 * open → in progress → resolved. The API enforces the same role split.
 */
export default function SupportPage() {
  const [role, setRole] = useState<'student' | 'instructor' | 'admin' | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api
      .session()
      .then((s) => setRole(s?.role ?? null))
      .catch(() => setRole(null))
      .finally(() => setLoaded(true));
  }, []);

  if (!loaded) return <p className="muted">Loading support…</p>;
  if (!role) return <p className="error">Please sign in to report an issue.</p>;

  return (
    <div>
      <h1>Support</h1>
      <ReportForm />
      {role === 'student' ? null : <SupportQueue />}
    </div>
  );
}

function ReportForm() {
  const [category, setCategory] = useState<SupportCategory>('bug');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [pageUrl, setPageUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filed, setFiled] = useState<SupportIssue | null>(null);

  useEffect(() => {
    // Capture the page the reporter was on, so triage has a reproduction.
    if (typeof window !== 'undefined') setPageUrl(window.location.pathname);
  }, []);

  const submit = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      const issue = await api.reportIssue({
        category,
        title: title.trim(),
        description: description.trim(),
        pageUrl: pageUrl || undefined,
      });
      setFiled(issue);
      setTitle('');
      setDescription('');
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 400
          ? 'Please add a title and a description.'
          : 'Could not file your report. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  }, [category, title, description, pageUrl]);

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h2 style={{ marginTop: 0 }}>Report an issue</h2>
      <p className="muted" style={{ maxWidth: 640 }}>
        Tell us what went wrong and what you expected instead. We record the page
        you are on so we can reproduce it.
      </p>

      {filed ? (
        <p className="muted">
          Thanks — your report was filed. Reference <code>{filed.id}</code>.
        </p>
      ) : null}
      {error ? <p className="error">{error}</p> : null}

      <label htmlFor="issue-category">Category</label>
      <select
        id="issue-category"
        value={category}
        onChange={(e) => setCategory(e.target.value as SupportCategory)}
      >
        {CATEGORIES.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>

      <label htmlFor="issue-title">Title</label>
      <input
        id="issue-title"
        value={title}
        maxLength={200}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="One-line summary"
      />

      <label htmlFor="issue-description">What happened?</label>
      <textarea
        id="issue-description"
        value={description}
        rows={5}
        style={{ width: '100%' }}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Steps to reproduce, what you expected, what you saw."
      />

      <p className="muted" style={{ fontSize: 13 }}>
        Page: <code>{pageUrl || '/'}</code>
      </p>

      <button
        type="button"
        className="btn"
        disabled={submitting || !title.trim() || !description.trim()}
        onClick={() => void submit()}
      >
        {submitting ? 'Filing…' : 'Submit report'}
      </button>
    </div>
  );
}

function SupportQueue() {
  const [issues, setIssues] = useState<SupportIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api
      .supportIssues()
      .then(setIssues)
      .catch(() => setError('Could not load the support queue.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  async function advance(issue: SupportIssue, status: SupportStatus) {
    try {
      const updated = await api.setSupportIssueStatus(issue.id, status);
      setIssues((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
    } catch {
      setError('Could not update that issue. Please try again.');
    }
  }

  return (
    <div style={{ marginTop: 24 }}>
      <h2>Support queue</h2>
      <p className="muted" style={{ maxWidth: 640 }}>
        Every report filed by your tenant, newest first. Move an issue along as
        you work it.
      </p>
      {error ? <p className="error">{error}</p> : null}
      {loading ? <p className="muted">Loading queue…</p> : null}
      {!loading && issues.length === 0 ? (
        <p className="muted">No issues have been reported yet.</p>
      ) : null}

      <div className="grid">
        {issues.map((issue) => (
          <div key={issue.id} className="card">
            <div className="row">
              <h3 style={{ margin: 0 }}>{issue.title}</h3>
              <span className={`pill ${issue.status}`}>
                {STATUS_LABEL[issue.status]}
              </span>
            </div>
            <p className="muted" style={{ marginTop: 4 }}>
              {issue.category} · {issue.pageUrl ?? 'unknown page'} ·{' '}
              {new Date(issue.createdAt).toLocaleString()}
            </p>
            <p style={{ whiteSpace: 'pre-wrap' }}>{issue.description}</p>
            <div className="row">
              {NEXT_STATUS.filter((s) => s !== issue.status).map((status) => (
                <button
                  key={status}
                  type="button"
                  className="btn secondary"
                  onClick={() => void advance(issue, status)}
                >
                  Mark {STATUS_LABEL[status].toLowerCase()}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
