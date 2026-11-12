import type {
  MembershipRepository,
  ProjectComponentRepository,
  ProjectForkRepository,
  ProjectRecord,
  ProjectRepository,
  ProjectSubmissionRecord,
  ProjectSubmissionRepository,
  ProjectWorkspaceRecord,
  ProjectWorkspaceRepository,
} from '../common/ports';

export interface SubmitRequest {
  userId: string;
  tenantId: string;
  projectId: string;
  componentId: string;
  workspaceId: string;
  title: string;
  description?: string;
  githubUrl?: string | null;
  demoUrl?: string | null;
}

export type SubmitResult =
  | { ok: true; submission: ProjectSubmissionRecord }
  | { ok: false; reason: SubmitFailureReason; message: string };

export type SubmitFailureReason =
  | 'project_not_found'
  | 'project_not_open'
  | 'deadline_passed'
  | 'component_not_found'
  | 'membership_required'
  | 'fork_required'
  | 'workspace_not_found'
  | 'workspace_active'
  | 'workspace_not_ready';

export interface EvaluateResult {
  ok: true;
  submission: ProjectSubmissionRecord;
}
export type EvaluateFailureReason =
  | 'submission_not_found'
  | 'score_out_of_range';
export type EvaluateOutcome =
  | EvaluateResult
  | { ok: false; reason: EvaluateFailureReason; message: string };

/** A student's submission joined with the workspace it snapshots. */
export interface StudentSubmissionView {
  submission: ProjectSubmissionRecord;
  workspace: ProjectWorkspaceRecord | null;
}

export interface SubmissionDeps {
  projects: ProjectRepository;
  components: ProjectComponentRepository;
  workspaces: ProjectWorkspaceRepository;
  forks: ProjectForkRepository;
  submissions: ProjectSubmissionRepository;
  memberships: MembershipRepository;
}

/**
 * Owns project submission and trainer evaluation (Phase E, E3).
 *
 * Mirrors ByteXL's submission rules (docs/BYTEXL_PARITY_ANALYSIS.md §1.2):
 *  - a submission carries a title, description, the student's workspace, and
 *    optional GitHub/demo links;
 *  - the **deadline is server-authoritative** — a project past its deadline is
 *    closed and cannot be submitted;
 *  - a workspace must be **stopped before submit** (the snapshot is taken from a
 *    closed workspace), so an active fork is rejected with the same wait hint
 *    ByteXL shows.
 *
 * Submission is idempotent per (component, student): re-submitting replaces the
 * prior row rather than accumulating duplicates, which keeps the trainer view
 * and the deadline rule honest.
 */
export class ProjectSubmissionService {
  constructor(private readonly deps: SubmissionDeps) {}

  async submit(req: SubmitRequest, now = new Date()): Promise<SubmitResult> {
    const project = await this.deps.projects.findById(req.projectId);
    if (!project) {
      return { ok: false, reason: 'project_not_found', message: 'Project not found' };
    }
    if (project.status !== 'published') {
      return {
        ok: false,
        reason: 'project_not_open',
        message: `Project is not open for submissions (status: ${project.status})`,
      };
    }
    if (isPastDeadline(project, now)) {
      return {
        ok: false,
        reason: 'deadline_passed',
        message: 'The submission deadline has passed. This project is closed.',
      };
    }

    const membership = await this.deps.memberships.find(req.userId, req.tenantId);
    if (!membership || membership.status !== 'active') {
      return {
        ok: false,
        reason: 'membership_required',
        message: 'User is not an active member of this tenant',
      };
    }

    const component = await this.deps.components.findById(req.componentId);
    if (!component || component.projectId !== project.id) {
      return {
        ok: false,
        reason: 'component_not_found',
        message: 'Component not found in this project',
      };
    }

    // The workspace must be the student's own fork of this component — a
    // submission cannot point at someone else's workspace.
    const fork = await this.deps.forks.findByComponentAndUser(component.id, req.userId);
    if (!fork || fork.workspaceId !== req.workspaceId) {
      return {
        ok: false,
        reason: 'fork_required',
        message: 'Fork this component into your own workspace before submitting',
      };
    }

    const workspace = await this.deps.workspaces.findById(req.workspaceId);
    if (!workspace || workspace.userId !== req.userId) {
      return {
        ok: false,
        reason: 'workspace_not_found',
        message: 'Workspace not found',
      };
    }
    if (workspace.status === 'running' || workspace.status === 'provisioning') {
      return {
        ok: false,
        reason: 'workspace_active',
        message:
          'Close your workspace and wait a minute for the session to stop, then submit again.',
      };
    }
    if (workspace.status !== 'stopped') {
      return {
        ok: false,
        reason: 'workspace_not_ready',
        message: `Workspace is not ready to submit (status: ${workspace.status})`,
      };
    }

    const fields = {
      tenantId: req.tenantId,
      projectId: project.id,
      componentId: component.id,
      userId: req.userId,
      workspaceId: workspace.id,
      title: req.title,
      description: req.description ?? '',
      githubUrl: req.githubUrl ?? null,
      demoUrl: req.demoUrl ?? null,
    };

    // One submission per (component, student): replace the prior row so a
    // resubmission does not leave a stale duplicate in the trainer view.
    const existing = (await this.deps.submissions.listByUser(req.tenantId, req.userId)).find(
      (s) => s.componentId === component.id,
    );
    const submission = existing
      ? await this.deps.submissions.update(existing.id, {
          ...fields,
          status: 'submitted',
          score: null,
          feedback: null,
          submittedAt: now,
          evaluatedAt: null,
        })
      : await this.deps.submissions.create({ ...fields, status: 'submitted', score: null, feedback: null });

    return { ok: true, submission };
  }

  /** A student's submissions with the workspace each one snapshots. */
  async listForStudent(tenantId: string, userId: string): Promise<StudentSubmissionView[]> {
    const rows = await this.deps.submissions.listByUser(tenantId, userId);
    return Promise.all(
      rows.map(async (submission) => ({
        submission,
        workspace: await this.deps.workspaces.findById(submission.workspaceId),
      })),
    );
  }

  /** Every submission for a project — the instructor's evaluation queue. */
  async listForProject(
    tenantId: string,
    projectId: string,
  ): Promise<ProjectSubmissionRecord[]> {
    return this.deps.submissions.listByProject(tenantId, projectId);
  }

  /** Record a trainer's score and feedback against a submission. */
  async evaluate(
    tenantId: string,
    submissionId: string,
    input: { score: number; feedback?: string | null },
    now = new Date(),
  ): Promise<EvaluateOutcome> {
    const submission = await this.deps.submissions.findById(submissionId);
    if (!submission || submission.tenantId !== tenantId) {
      return {
        ok: false,
        reason: 'submission_not_found',
        message: 'Submission not found',
      };
    }
    const project = await this.deps.projects.findById(submission.projectId);
    const maxScore = project?.maxScore ?? 100;
    if (!Number.isFinite(input.score) || input.score < 0 || input.score > maxScore) {
      return {
        ok: false,
        reason: 'score_out_of_range',
        message: `Score must be between 0 and ${maxScore}`,
      };
    }

    const updated = await this.deps.submissions.update(submissionId, {
      status: 'evaluated',
      score: input.score,
      feedback: input.feedback ?? null,
      evaluatedAt: now,
    });
    return { ok: true, submission: updated };
  }
}

/** Whether a project's deadline has passed, making it closed for submission. */
export function isPastDeadline(project: ProjectRecord, now = new Date()): boolean {
  return project.deadline !== null && project.deadline.getTime() < now.getTime();
}
