'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  api,
  ApiError,
  type InstructorProjectView,
  type ForkStatus,
  type ProjectSubmission,
  type ProjectTemplate,
  type ProjectTemplateCategory,
  type Session,
  type StudentProjectView,
  type TenantUsage,
} from '@/lib/api';
import {
  formatUsd,
  projectDeadlineLabel,
  submissionStatusLabel,
  templateCategoryLabel,
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
  const [statuses, setStatuses] = useState<Record<string, ForkStatus>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [p, s] = await Promise.all([api.projects(), api.myProjectSubmissions()]);
    const views = p as StudentProjectView[];
    setProjects(views);
    setSubmissions(s.map((v) => v.submission));
    // One status read per fork powers the landing strip's "live projects" count.
    const forkIds = views.flatMap((view) =>
      view.components.filter((c) => c.fork).map((c) => c.fork!.id),
    );
    const pairs = await Promise.all(
      forkIds.map((id) => api.forkStatus(id).then((st) => [id, st] as const)),
    );
    setStatuses(Object.fromEntries(pairs));
  }, []);

  useEffect(() => {
    load()
      .catch(() => setError('Could not load your projects. Please try again.'))
      .finally(() => setLoading(false));
  }, [load]);

  if (loading) return <p className="muted">Loading projects…</p>;

  // The Nimbus landing strip (Nov'25 §1.5): a student's workspaces, live apps,
  // and the projects still open to fork, all on one view.
  const workspaceCount = projects.reduce(
    (n, view) => n + view.components.filter((c) => c.fork).length,
    0,
  );
  const liveAppCount = Object.values(statuses).filter((s) => s.deployUrl).length;

  return (
    <div>
      <h1>Nimbus Projects</h1>
      <p className="muted" style={{ maxWidth: 680 }}>
        Build real projects in a cloud VS Code workspace. Fork a template, write
        your code, stop the workspace, then submit it with a GitHub or demo link
        for your trainer to evaluate.
      </p>

      <div className="grid" style={{ marginTop: 16 }}>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Your workspaces</h3>
          <p className="muted" style={{ marginBottom: 0 }}>
            {workspaceCount} forked workspace{workspaceCount === 1 ? '' : 's'} ·{' '}
            <Link href="/nimbus/apps">Nimbus Apps →</Link>
          </p>
        </div>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Live projects</h3>
          <p className="muted" style={{ marginBottom: 0 }}>
            {liveAppCount} published app{liveAppCount === 1 ? '' : 's'} with a
            demo URL
          </p>
        </div>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Open projects</h3>
          <p className="muted" style={{ marginBottom: 0 }}>
            {projects.length} project{projects.length === 1 ? '' : 's'} available
            to fork
          </p>
        </div>
      </div>

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
                {s.autoScore !== null ? (
                  <p className="muted" style={{ marginBottom: 0 }}>
                    Auto-evaluation: {s.autoScore}/100
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
  const [templateSlug, setTemplateSlug] = useState(templates[0]?.slug ?? '');
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
      const chosen =
        templates.find((t) => t.slug === templateSlug) ?? templates[0];
      if (chosen) {
        await api.addProjectComponent(project.id, {
          title: chosen.title,
          technology: chosen.stack,
          templateSlug: chosen.slug,
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
        <label htmlFor="project-template">Starting template</label>
        <select
          id="project-template"
          value={templateSlug}
          onChange={(e) => setTemplateSlug(e.target.value)}
        >
          {groupTemplates(templates).map(([category, group]) => (
            <optgroup key={category} label={templateCategoryLabel(category)}>
              {group.map((t) => (
                <option key={t.slug} value={t.slug}>
                  {t.title}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {error ? <p className="error">{error}</p> : null}
        <button className="btn" type="submit" disabled={busy || !title.trim()}>
          Create draft
        </button>
      </form>
    </div>
  );
}

/** Group templates by picker category, in a stable display order. */
function groupTemplates(
  templates: ProjectTemplate[],
): Array<[ProjectTemplateCategory, ProjectTemplate[]]> {
  const order: ProjectTemplateCategory[] = [
    'front_end',
    'back_end',
    'full_stack',
    'database',
    'other',
  ];
  const byCategory = new Map<ProjectTemplateCategory, ProjectTemplate[]>();
  for (const template of templates) {
    const list = byCategory.get(template.category) ?? [];
    list.push(template);
    byCategory.set(template.category, list);
  }
  return order
    .filter((category) => byCategory.has(category))
    .map((category) => [category, byCategory.get(category)!]);
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
      {submission.autoScore !== null ? (
        <p className="muted" style={{ marginBottom: 8 }}>
          Auto-evaluation score: {submission.autoScore}/100
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
