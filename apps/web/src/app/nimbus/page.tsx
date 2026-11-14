'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  api,
  ApiError,
  type InstructorProjectView,
  type ProjectSubmission,
  type ProjectTemplate,
  type Session,
  type StudentProjectView,
  type TenantUsage,
} from '@/lib/api';
import {
  formatUsd,
  projectDeadlineLabel,
  submissionStatusLabel,
} from '@/lib/lms';
import { ProjectComponentCard } from '@/components/ProjectComponentCard';

/**
 * Nimbus — the ByteXL-equivalent project-building surface. A student picks a
 * published project, forks each component's template into a durable cloud
 * workspace, builds in an online VS Code, stops the workspace, and submits it
 * for trainer evaluation. An instructor authors and publishes projects and
 * scores the submissions. The role decides which view renders.
 */
export default function NimbusPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api
      .session()
      .then(setSession)
      .catch(() => setSession(null))
      .finally(() => setLoaded(true));
  }, []);

  if (!loaded) return <p className="muted">Loading projects…</p>;
  if (!session) return <p className="error">Please sign in to view projects.</p>;

  return session.role === 'student' ? (
    <StudentProjects />
  ) : (
    <InstructorProjects />
  );
}

// ------------------------------------------------------------------ student

function StudentProjects() {
  const [projects, setProjects] = useState<StudentProjectView[]>([]);
  const [submissions, setSubmissions] = useState<ProjectSubmission[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [p, s] = await Promise.all([api.projects(), api.myProjectSubmissions()]);
    setProjects(p as StudentProjectView[]);
    setSubmissions(s.map((v) => v.submission));
  }, []);

  useEffect(() => {
    load()
      .catch(() => setError('Could not load your projects. Please try again.'))
      .finally(() => setLoading(false));
  }, [load]);

  if (loading) return <p className="muted">Loading projects…</p>;

  return (
    <div>
      <h1>Nimbus Projects</h1>
      <p className="muted" style={{ maxWidth: 680 }}>
        Build real projects in a cloud VS Code workspace. Fork a template, write
        your code, stop the workspace, then submit it with a GitHub or demo link
        for your trainer to evaluate.
      </p>

      {error ? <p className="error">{error}</p> : null}

      {projects.length === 0 ? (
        <p className="muted" style={{ marginTop: 16 }}>
          No projects are open right now. Check back when your instructor
          publishes one.
        </p>
      ) : (
        projects.map((view) => (
          <section key={view.project.id} style={{ marginTop: 24 }}>
            <div className="row">
              <h2 style={{ marginBottom: 0 }}>{view.project.title}</h2>
              <span className="pill">
                {projectDeadlineLabel(view.project.deadline)}
              </span>
            </div>
            <p className="muted" style={{ maxWidth: 680 }}>
              {view.project.description}
            </p>
            <div className="grid">
              {view.components.map((component) => (
                <ProjectComponentCard
                  key={component.id}
                  project={view.project}
                  component={component}
                  onChanged={load}
                />
              ))}
            </div>
          </section>
        ))
      )}

      {submissions.length > 0 ? (
        <>
          <h2 style={{ marginTop: 32 }}>Your submissions</h2>
          <div className="grid">
            {submissions.map((s) => (
              <div key={s.id} className="card">
                <div className="row">
                  <h3 style={{ margin: 0 }}>{s.title}</h3>
                  <span className="pill">{submissionStatusLabel(s)}</span>
                </div>
                <p className="muted" style={{ marginBottom: 0 }}>
                  {s.description || 'No description.'}
                </p>
                {s.feedback ? (
                  <p className="muted" style={{ marginBottom: 0 }}>
                    Trainer feedback: {s.feedback}
                  </p>
                ) : null}
                {s.githubUrl ? (
                  <p style={{ marginBottom: 0 }}>
                    <a href={s.githubUrl} target="_blank" rel="noreferrer">
                      GitHub repository →
                    </a>
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

// --------------------------------------------------------------- instructor

function InstructorProjects() {
  const [projects, setProjects] = useState<InstructorProjectView[]>([]);
  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [p, t] = await Promise.all([api.projects(), api.projectTemplates()]);
    setProjects(p as InstructorProjectView[]);
    setTemplates(t);
  }, []);

  useEffect(() => {
    load()
      .catch((err) => {
        setError(
          err instanceof ApiError && err.status === 403
            ? 'Project authoring is available to instructors and admins.'
            : 'Could not load projects. Please try again.',
        );
      })
      .finally(() => setLoading(false));
  }, [load]);

  if (loading) return <p className="muted">Loading projects…</p>;

  return (
    <div>
      <h1>Nimbus Projects</h1>
      <p className="muted" style={{ maxWidth: 680 }}>
        Author projects as a set of technology components, each backed by a
        template. Publish a project to let students fork it, build in the cloud
        IDE, and submit for your evaluation.
      </p>

      {error ? <p className="error">{error}</p> : null}

      <UsageCard />

      <CreateProjectCard templates={templates} onCreated={load} />

      <h2 style={{ marginTop: 32 }}>Your projects</h2>
      {projects.length === 0 ? (
        <p className="muted">No projects yet. Create one above.</p>
      ) : (
        <div className="grid">
          {projects.map((view) => (
            <div key={view.project.id} className="card">
              <div className="row">
                <h3 style={{ margin: 0 }}>{view.project.title}</h3>
                <span className="pill">{view.project.status}</span>
              </div>
              <p className="muted" style={{ marginBottom: 8 }}>
                {view.components.length} component
                {view.components.length === 1 ? '' : 's'} · {view.forkCount} fork
                {view.forkCount === 1 ? '' : 's'} ·{' '}
                {projectDeadlineLabel(view.project.deadline)}
              </p>
              {view.project.status === 'draft' ? (
                <button
                  className="btn"
                  onClick={async () => {
                    await api.publishProject(view.project.id);
                    await load();
                  }}
                >
                  Publish
                </button>
              ) : (
                <button
                  className="btn secondary"
                  onClick={() =>
                    setOpenId(openId === view.project.id ? null : view.project.id)
                  }
                >
                  {openId === view.project.id ? 'Hide submissions' : 'Review submissions'}
                </button>
              )}
              {openId === view.project.id ? (
                <EvaluationQueue projectId={view.project.id} />
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Tenant cost and quota for the billing period — the capacity-planning view. */
function UsageCard() {
  const [usage, setUsage] = useState<TenantUsage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .usage()
      .then(setUsage)
      .catch(() => setError('Could not load usage. Please try again.'));
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!usage) return null;

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Usage this month</h3>
      <p className="muted" style={{ marginBottom: 8 }}>
        {formatUsd(usage.totalCents)} spent · {usage.activeSessions} active lab
        {usage.activeSessions === 1 ? '' : 's'}
      </p>
      {usage.budget ? (
        <>
          <div className="progress">
            <span style={{ width: `${Math.min(100, usage.budget.percent)}%` }} />
          </div>
          <p className="muted" style={{ marginBottom: 0 }}>
            {usage.budget.percent}% of{' '}
            {formatUsd(usage.budget.monthlyBudgetCents)} budget
            {usage.budget.level === 'exceeded' ? ' — limit reached' : ''}
          </p>
        </>
      ) : null}
    </div>
  );
}

function CreateProjectCard({
  templates,
  onCreated,
}: {
  templates: ProjectTemplate[];
  onCreated: () => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [deadline, setDeadline] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const project = await api.createProject({
        title: title.trim(),
        description: description.trim(),
        deadline: deadline ? new Date(deadline).toISOString() : null,
      });
      // Give the new project one component so a student has something to fork.
      if (templates[0]) {
        await api.addProjectComponent(project.id, {
          title: templates[0].title,
          technology: templates[0].stack,
          templateSlug: templates[0].slug,
        });
      }
      setTitle('');
      setDescription('');
      setDeadline('');
      onCreated();
    } catch {
      setError('Could not create the project.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h3 style={{ marginTop: 0 }}>Create a project</h3>
      <form onSubmit={create}>
        <label htmlFor="project-title">Title</label>
        <input
          id="project-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Build a task API"
        />
        <label htmlFor="project-desc">Description</label>
        <input
          id="project-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What should students build?"
        />
        <label htmlFor="project-deadline">Deadline (optional)</label>
        <input
          id="project-deadline"
          type="datetime-local"
          value={deadline}
          onChange={(e) => setDeadline(e.target.value)}
        />
        {error ? <p className="error">{error}</p> : null}
        <button className="btn" type="submit" disabled={busy || !title.trim()}>
          Create draft
        </button>
      </form>
    </div>
  );
}

function EvaluationQueue({ projectId }: { projectId: string }) {
  const [rows, setRows] = useState<ProjectSubmission[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRows(await api.projectSubmissions(projectId));
  }, [projectId]);

  useEffect(() => {
    load().catch(() => setError('Could not load submissions.'));
  }, [load]);

  if (error) return <p className="error">{error}</p>;
  if (rows.length === 0) {
    return <p className="muted">No submissions yet.</p>;
  }

  return (
    <div style={{ marginTop: 12 }}>
      {rows.map((row) => (
        <EvaluateRow key={row.id} submission={row} onEvaluated={load} />
      ))}
    </div>
  );
}

function EvaluateRow({
  submission,
  onEvaluated,
}: {
  submission: ProjectSubmission;
  onEvaluated: () => void;
}) {
  const [score, setScore] = useState(String(submission.score ?? ''));
  const [feedback, setFeedback] = useState(submission.feedback ?? '');
  const [busy, setBusy] = useState(false);

  async function save() {
    const value = Number(score);
    if (!Number.isFinite(value)) return;
    setBusy(true);
    try {
      await api.evaluateSubmission(submission.id, value, feedback);
      onEvaluated();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ marginTop: 8 }}>
      <div className="row">
        <strong>{submission.title}</strong>
        <span className="pill">{submissionStatusLabel(submission)}</span>
      </div>
      <p className="muted" style={{ marginBottom: 8 }}>
        {submission.description || 'No description.'}
      </p>
      {submission.githubUrl ? (
        <p className="muted" style={{ marginBottom: 8 }}>
          <a href={submission.githubUrl} target="_blank" rel="noreferrer">
            {submission.githubUrl}
          </a>
        </p>
      ) : null}
      <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
        <div style={{ width: 100 }}>
          <label htmlFor={`score-${submission.id}`}>Score</label>
          <input
            id={`score-${submission.id}`}
            type="number"
            value={score}
            onChange={(e) => setScore(e.target.value)}
          />
        </div>
        <div style={{ flex: 1 }}>
          <label htmlFor={`fb-${submission.id}`}>Feedback</label>
          <input
            id={`fb-${submission.id}`}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
          />
        </div>
        <button className="btn" onClick={save} disabled={busy || !score}>
          Save score
        </button>
      </div>
    </div>
  );
}
