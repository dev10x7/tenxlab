'use client';

import { useEffect, useState } from 'react';
import {
  api,
  ApiError,
  type RecruiterRow,
  type SkillPassport,
} from '@/lib/api';
import {
  badgeKindLabel,
  communicationLabel,
  readinessLabel,
  scoreLabel,
} from '@/lib/lms';

/**
 * Resumes — the Skill Passport (ByteXL parity §2.8).
 *
 * A student sees their own passport: the verified badges earned from labs,
 * assessments, projects, and mock interviews, with the blended scores a
 * recruiter reads. Instructors and admins additionally get the recruiter
 * shortlist, filterable by score and name.
 */
export default function ResumesPage() {
  const [role, setRole] = useState<'student' | 'instructor' | 'admin' | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api
      .session()
      .then((s) => setRole(s?.role ?? null))
      .catch(() => setRole(null))
      .finally(() => setLoaded(true));
  }, []);

  if (!loaded) return <p className="muted">Loading passport…</p>;
  if (!role) return <p className="error">Please sign in to view your passport.</p>;

  return (
    <div>
      <h1>Resumes</h1>
      <p className="muted" style={{ maxWidth: 640 }}>
        Your skill passport: verified evidence from labs, assessments, projects,
        and mock interviews.
      </p>
      <MyPassport />
      {role === 'student' ? null : <RecruiterShortlist />}
    </div>
  );
}

function MyPassport() {
  const [passport, setPassport] = useState<SkillPassport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .passport()
      .then(setPassport)
      .catch(() => setError('Could not load your passport.'));
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!passport) return <p className="muted">Loading your passport…</p>;

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h3 style={{ marginTop: 0 }}>{passport.fullName}</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        {passport.email}
      </p>
      <div className="row" style={{ gap: 24, flexWrap: 'wrap' }}>
        <Stat label="Verified badges" value={String(passport.verifiedBadges)} />
        <Stat label="Avg lab score" value={scoreLabel(passport.avgLabScore)} />
        <Stat
          label="Avg assessment"
          value={scoreLabel(passport.avgAssessmentScore)}
        />
        <Stat
          label="Communication"
          value={communicationLabel(passport.communicationScore)}
        />
        <Stat
          label="Best contest rank"
          value={passport.bestContestRank != null ? `#${passport.bestContestRank}` : '—'}
        />
      </div>

      <h4 style={{ marginTop: 24 }}>Badges</h4>
      {passport.badges.length === 0 ? (
        <p className="muted">
          No badges yet. Complete a lab, an assessment, a project, or a mock
          interview to earn one.
        </p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0 }}>
          {passport.badges.map((badge) => (
            <li
              key={badge.id}
              className="row"
              style={{ padding: '8px 0', borderBottom: '1px solid #eee' }}
            >
              <span className="pill">{badgeKindLabel(badge.kind)}</span>
              <span style={{ marginLeft: 12 }}>{badge.label}</span>
              <span className="muted" style={{ marginLeft: 'auto' }}>
                {scoreLabel(badge.score)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RecruiterShortlist() {
  const [rows, setRows] = useState<RecruiterRow[] | null>(null);
  const [filters, setFilters] = useState({
    query: '',
    institution: '',
    graduationYear: '',
    minLabScore: '',
    minCommunicationScore: '',
    minBadges: '',
  });
  const [error, setError] = useState<string | null>(null);

  const active = () => ({
    query: filters.query.trim() || undefined,
    institution: filters.institution.trim() || undefined,
    graduationYear: filters.graduationYear ? Number(filters.graduationYear) : undefined,
    minLabScore: filters.minLabScore ? Number(filters.minLabScore) : undefined,
    minCommunicationScore: filters.minCommunicationScore
      ? Number(filters.minCommunicationScore)
      : undefined,
    minBadges: filters.minBadges ? Number(filters.minBadges) : undefined,
  });

  const set = (key: keyof typeof filters) => (value: string) =>
    setFilters((f) => ({ ...f, [key]: value }));

  const load = async () => {
    setError(null);
    try {
      setRows(await api.recruiterPassports(active()));
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 403
          ? 'The recruiter view is available to instructors and admins.'
          : 'Could not load the shortlist.',
      );
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section style={{ marginTop: 32 }}>
      <div className="row" style={{ alignItems: 'baseline' }}>
        <h2>Recruiter shortlist</h2>
        <a
          className="pill"
          style={{ marginLeft: 'auto' }}
          href={api.recruiterCsvUrl(active())}
        >
          Export CSV
        </a>
      </div>
      <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Field label="Name or email" value={filters.query} onChange={set('query')} placeholder="Search" />
        <Field
          label="Institution"
          value={filters.institution}
          onChange={set('institution')}
          placeholder="e.g. Acme"
        />
        <Field
          label="Graduation year"
          value={filters.graduationYear}
          onChange={set('graduationYear')}
          placeholder="e.g. 2026"
        />
        <Field
          label="Min lab score"
          value={filters.minLabScore}
          onChange={set('minLabScore')}
          placeholder="e.g. 70"
        />
        <Field
          label="Min communication"
          value={filters.minCommunicationScore}
          onChange={set('minCommunicationScore')}
          placeholder="e.g. 60"
        />
        <Field
          label="Min badges"
          value={filters.minBadges}
          onChange={set('minBadges')}
          placeholder="e.g. 2"
        />
        <button onClick={() => void load()}>Filter</button>
      </div>

      {error ? <p className="error">{error}</p> : null}
      {rows === null && !error ? <p className="muted">Loading shortlist…</p> : null}

      {rows ? (
        <table className="gradebook" style={{ marginTop: 16 }}>
          <thead>
            <tr>
              <th>Candidate</th>
              <th>Institution</th>
              <th>Grad year</th>
              <th>Badges</th>
              <th>Avg lab</th>
              <th>Communication</th>
              <th>Best rank</th>
              <th>Readiness</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.userId}>
                <td>
                  {row.fullName}
                  <div className="muted" style={{ fontSize: 12 }}>
                    {row.email}
                  </div>
                </td>
                <td>{row.institution || '—'}</td>
                <td>{row.graduationYear ?? '—'}</td>
                <td>{row.verifiedBadges}</td>
                <td>{scoreLabel(row.avgLabScore)}</td>
                <td>{communicationLabel(row.communicationScore)}</td>
                <td>{row.bestContestRank != null ? `#${row.bestContestRank}` : '—'}</td>
                <td>{readinessLabel(row.readiness)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label>
      <div className="muted" style={{ fontSize: 12 }}>
        {label}
      </div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode={label.includes('Name') || label.includes('Institution') ? undefined : 'numeric'}
      />
    </label>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="muted" style={{ fontSize: 12 }}>
        {label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 600 }}>{value}</div>
    </div>
  );
}
