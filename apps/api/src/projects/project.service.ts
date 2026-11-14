import type { LabSpec, RuntimeTier, SessionHandle } from '@tenxlab/contracts';
import type { LabProvider, ServiceExposer } from '@tenxlab/lab-provider';
import { routeTier } from '@tenxlab/runtime-policy';
import type {
  MembershipRepository,
  ProjectComponentRecord,
  ProjectComponentRepository,
  ProjectForkRecord,
  ProjectForkRepository,
  ProjectRecord,
  ProjectRepository,
  ProjectWorkspaceRecord,
  ProjectWorkspaceRepository,
} from '../common/ports';
import { findTemplate, listTemplates, type TemplateSeed } from './templates';

/** A project as the student sees it: components plus their own fork, if any. */
export interface StudentProjectView {
  project: ProjectRecord;
  components: Array<ProjectComponentRecord & { fork: ProjectForkRecord | null }>;
}

/** A project as the instructor sees it: components plus the fork roster size. */
export interface InstructorProjectView {
  project: ProjectRecord;
  components: ProjectComponentRecord[];
  forkCount: number;
}

export interface CreateProjectInput {
  tenantId: string;
  title: string;
  description?: string;
  runtimeTier?: RuntimeTier;
  deadline?: string | null;
  maxScore?: number;
}

export interface CreateComponentInput {
  tenantId: string;
  title: string;
  technology: string;
  templateSlug?: string | null;
  templateWorkspaceId?: string | null;
  position?: number;
}

export type ProjectWriteResult =
  | { ok: true; project: ProjectRecord }
  | { ok: false; reason: ProjectWriteFailure; message: string };

export type ComponentWriteResult =
  | { ok: true; component: ProjectComponentRecord }
  | { ok: false; reason: ProjectWriteFailure; message: string };

export type ProjectWriteFailure =
  | 'project_not_found'
  | 'invalid_title'
  | 'unknown_template'
  | 'template_required';

export type StopResult =
  | { ok: true; workspace: ProjectWorkspaceRecord }
  | { ok: false; reason: 'workspace_not_found'; message: string };

export type DeployResult =
  | { ok: true; workspace: ProjectWorkspaceRecord }
  | { ok: false; reason: DeployFailureReason; message: string };

export type DeployFailureReason =
  | 'workspace_not_found'
  | 'workspace_not_running'
  | 'deploy_unavailable'
  | 'deploy_failed';

export interface ForkRequest {
  userId: string;
  tenantId: string;
  projectId: string;
  componentId: string;
}

export type ForkResult =
  | {
      ok: true;
      forkId: string;
      workspaceId: string;
      status: string;
      tier: RuntimeTier;
      ideUrl?: string | null;
    }
  | { ok: false; reason: ForkFailureReason; message: string };

export type ForkFailureReason =
  | 'project_not_found'
  | 'project_not_published'
  | 'component_not_found'
  | 'membership_required';

export interface ForkDeps {
  projects: ProjectRepository;
  components: ProjectComponentRepository;
  workspaces: ProjectWorkspaceRepository;
  forks: ProjectForkRepository;
  memberships: MembershipRepository;
  /** Null disables real provisioning (unit tests, catalog-only deployments). */
  provider?: LabProvider | null;
  /**
   * Publishes a running workspace's service on a public URL (E5). Null disables
   * Deploy, exactly as a null `provider` disables forking.
   */
  exposer?: ServiceExposer | null;
  /** Default runtime tier for a fork when the project declares none. */
  defaultTier?: RuntimeTier;
}

/**
 * Owns the project fork lifecycle (Phase E, E1).
 *
 * A fork copies one component's template into a new durable workspace for the
 * student and records the fork. Provisioning is **asynchronous**, exactly like
 * `LabLaunchService`: a KubeLab/pod cold start takes minutes, far longer than
 * an HTTP request should block. The caller polls `getFork` until the workspace
 * reports `running` and an `ideUrl`.
 *
 * Two invariants from ADR-20:
 *  - Forks live in their own tables, never in `lab_sessions`. The lab
 *    operator's short idle sweep would otherwise reap a student's long-lived
 *    work; project expiry is a separate policy (E5b).
 *  - A failed provision is recorded as `failed`, never `stopped`. `stopped`
 *    promises the files survived; `failed` means there is nothing to resume.
 */
export class ProjectService {
  constructor(private readonly deps: ForkDeps) {}

  async fork(req: ForkRequest): Promise<ForkResult> {
    const project = await this.deps.projects.findById(req.projectId);
    if (!project) {
      return { ok: false, reason: 'project_not_found', message: 'Project not found' };
    }
    if (project.status !== 'published') {
      return {
        ok: false,
        reason: 'project_not_published',
        message: `Project is not open for forks (status: ${project.status})`,
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

    const tier = this.resolveTier(project);

    // One fork per (component, student). Re-forking re-attaches to the existing
    // workspace rather than leaking a second one; a student who has not forked
    // yet gets a fresh workspace and an async provision.
    const existing = await this.deps.forks.findByComponentAndUser(
      component.id,
      req.userId,
    );
    if (existing) {
      const workspace = await this.deps.workspaces.findById(existing.workspaceId);
      // Re-forking a stopped or failed workspace resumes it: the durable volume
      // survived, so re-provision against the same id rather than re-attaching
      // to a dead environment.
      if (
        workspace &&
        (workspace.status === 'stopped' || workspace.status === 'failed') &&
        this.deps.provider
      ) {
        const resumed = await this.deps.workspaces.update(workspace.id, {
          status: 'provisioning',
          ideUrl: null,
          lastActivityAt: new Date(),
        });
        void this.provision(resumed, existing, component, tier).catch(() => {
          // provision() records the failure on the workspace row.
        });
        return {
          ok: true,
          forkId: existing.id,
          workspaceId: resumed.id,
          status: resumed.status,
          tier: (resumed.runtimeTier as RuntimeTier | undefined) ?? tier,
          ideUrl: null,
        };
      }
      return {
        ok: true,
        forkId: existing.id,
        workspaceId: existing.workspaceId,
        status: workspace?.status ?? 'stopped',
        tier: (workspace?.runtimeTier as RuntimeTier | undefined) ?? tier,
        ideUrl: workspace?.ideUrl ?? null,
      };
    }

    const workspace = await this.deps.workspaces.create({
      tenantId: req.tenantId,
      userId: req.userId,
      templateSlug: await this.resolveTemplateSlug(component),
      runtimeTier: tier,
      status: 'provisioning',
      ideUrl: null,
      storageRef: null,
    });

    const fork = await this.deps.forks.create({
      tenantId: req.tenantId,
      projectId: project.id,
      componentId: component.id,
      userId: req.userId,
      workspaceId: workspace.id,
      sourceTemplateSlug: component.templateSlug,
      sourceWorkspaceId: component.templateWorkspaceId,
    });

    if (this.deps.provider) {
      void this.provision(workspace, fork, component, tier).catch(() => {
        // provision() records the failure on the workspace row.
      });
    }

    return {
      ok: true,
      forkId: fork.id,
      workspaceId: workspace.id,
      status: workspace.status,
      tier,
      ideUrl: null,
    };
  }

  async getFork(forkId: string): Promise<ProjectForkRecord | null> {
    return this.deps.forks.findById(forkId);
  }

  /** The template catalog shown when authoring a component. */
  listTemplates(): TemplateSeed[] {
    return listTemplates();
  }

  /** Published projects a student can fork, each with their own fork state. */
  async listForStudent(tenantId: string, userId: string): Promise<StudentProjectView[]> {
    const projects = (await this.deps.projects.listByTenant(tenantId)).filter(
      (p) => p.status === 'published',
    );
    return Promise.all(
      projects.map(async (project) => ({
        project,
        components: await this.componentsWithFork(project.id, userId),
      })),
    );
  }

  /** A single published project with the student's fork state per component. */
  async getForStudent(
    tenantId: string,
    userId: string,
    projectId: string,
  ): Promise<StudentProjectView | null> {
    const project = await this.deps.projects.findById(projectId);
    if (!project || project.tenantId !== tenantId || project.status !== 'published') {
      return null;
    }
    return { project, components: await this.componentsWithFork(project.id, userId) };
  }

  /** Every project in the tenant for the instructor authoring view. */
  async listForInstructor(tenantId: string): Promise<InstructorProjectView[]> {
    const projects = await this.deps.projects.listByTenant(tenantId);
    return Promise.all(
      projects.map(async (project) => ({
        project,
        components: await this.deps.components.listByProject(project.id),
        forkCount: (await this.deps.forks.listByProject(project.id)).length,
      })),
    );
  }

  /** Author a new project. New projects start as drafts until published. */
  async createProject(input: CreateProjectInput): Promise<ProjectWriteResult> {
    const title = input.title?.trim();
    if (!title) {
      return { ok: false, reason: 'invalid_title', message: 'Title is required' };
    }
    const project = await this.deps.projects.create({
      tenantId: input.tenantId,
      title,
      description: input.description?.trim() ?? '',
      runtimeTier: input.runtimeTier ?? this.deps.defaultTier ?? 'tier_2_container',
      status: 'draft',
      deadline: parseDeadline(input.deadline),
      maxScore: input.maxScore ?? 100,
    });
    return { ok: true, project };
  }

  /** Add a technology slot to a project; a fork copies its template. */
  async addComponent(
    tenantId: string,
    projectId: string,
    input: CreateComponentInput,
  ): Promise<ComponentWriteResult> {
    const project = await this.deps.projects.findById(projectId);
    if (!project || project.tenantId !== tenantId) {
      return { ok: false, reason: 'project_not_found', message: 'Project not found' };
    }
    const title = input.title?.trim();
    if (!title) {
      return { ok: false, reason: 'invalid_title', message: 'Title is required' };
    }
    // A component names either a catalog template or an existing workspace to
    // copy; one of the two is required so a fork always has a source (§1.3).
    const templateSlug = input.templateSlug?.trim() || null;
    const templateWorkspaceId = input.templateWorkspaceId?.trim() || null;
    if (!templateSlug && !templateWorkspaceId) {
      return {
        ok: false,
        reason: 'template_required',
        message: 'Provide a template slug or a template workspace id',
      };
    }
    if (templateSlug && !findTemplate(templateSlug)) {
      return {
        ok: false,
        reason: 'unknown_template',
        message: `Unknown template "${templateSlug}"`,
      };
    }
    const existing = await this.deps.components.listByProject(projectId);
    const component = await this.deps.components.create({
      tenantId,
      projectId,
      title,
      technology: input.technology?.trim() || templateSlug || 'custom',
      templateSlug,
      templateWorkspaceId,
      position: input.position ?? existing.length,
    });
    return { ok: true, component };
  }

  /** Publish a project so students can see and fork it. */
  async publish(tenantId: string, projectId: string): Promise<ProjectWriteResult> {
    const project = await this.deps.projects.findById(projectId);
    if (!project || project.tenantId !== tenantId) {
      return { ok: false, reason: 'project_not_found', message: 'Project not found' };
    }
    const published = await this.deps.projects.update(projectId, { status: 'published' });
    return { ok: true, project: published };
  }

  /**
   * Stop a fork's workspace so it can be submitted. The provider namespace is
   * torn down but the durable volume is kept, so the files survive — `stopped`,
   * not `failed`. Required before submit (ByteXL stops the session first, §1.2).
   */
  async stopWorkspace(
    userId: string,
    workspaceId: string,
  ): Promise<StopResult> {
    const workspace = await this.deps.workspaces.findById(workspaceId);
    if (!workspace || workspace.userId !== userId) {
      return {
        ok: false,
        reason: 'workspace_not_found',
        message: 'Workspace not found',
      };
    }
    if (workspace.status !== 'running' && workspace.status !== 'provisioning') {
      return { ok: true, workspace };
    }
    if (this.deps.provider) {
      try {
        await this.deps.provider.terminate(workspace.id);
      } catch {
        // The provider may already be gone; the durable volume is untouched, so
        // a failed terminate still leaves the workspace stoppable.
      }
    }
    const stopped = await this.deps.workspaces.update(workspace.id, {
      status: 'stopped',
      ideUrl: null,
      // A stop tears the namespace down, so any exposed service is gone with it.
      deployUrl: null,
      deployPort: null,
      lastActivityAt: new Date(),
    });
    return { ok: true, workspace: stopped };
  }

  /**
   * Expose the workspace's service on a public URL (E5 one-click hosting).
   *
   * One workspace = one service = one URL (§1.4): the student runs their app on
   * `port` inside the IDE, then deploys it, mirroring ByteXL's `bytexl.live`
   * demo links. The workspace must be running — there is nothing to expose
   * otherwise — and the recorded `deployUrl` is what a submission carries as its
   * demo link.
   */
  async deploy(
    userId: string,
    workspaceId: string,
    port: number,
  ): Promise<DeployResult> {
    const workspace = await this.deps.workspaces.findById(workspaceId);
    if (!workspace || workspace.userId !== userId) {
      return { ok: false, reason: 'workspace_not_found', message: 'Workspace not found' };
    }
    if (workspace.status !== 'running') {
      return {
        ok: false,
        reason: 'workspace_not_running',
        message: 'Start the workspace before deploying its service',
      };
    }
    const exposer = this.deps.exposer;
    if (!exposer) {
      return {
        ok: false,
        reason: 'deploy_unavailable',
        message: 'One-click hosting is not available in this deployment',
      };
    }
    try {
      const exposed = await exposer.expose({ sessionId: workspace.id, port });
      const updated = await this.deps.workspaces.update(workspace.id, {
        deployUrl: exposed.url,
        deployPort: exposed.port,
        lastActivityAt: new Date(),
      });
      return { ok: true, workspace: updated };
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(
        `[project-deploy] expose failed for workspace ${workspace.id}:`,
        err instanceof Error ? `${err.name}: ${err.message}` : err,
      );
      return {
        ok: false,
        reason: 'deploy_failed',
        message: 'Could not deploy the service. Please try again.',
      };
    }
  }

  /** Withdraw a workspace's exposed service. Idempotent and ownership-scoped. */
  async undeploy(userId: string, workspaceId: string): Promise<DeployResult> {
    const workspace = await this.deps.workspaces.findById(workspaceId);
    if (!workspace || workspace.userId !== userId) {
      return { ok: false, reason: 'workspace_not_found', message: 'Workspace not found' };
    }
    if (this.deps.exposer) {
      try {
        await this.deps.exposer.unexpose(workspace.id);
      } catch {
        // The environment may already be gone; the record is still cleared.
      }
    }
    const updated = await this.deps.workspaces.update(workspace.id, {
      deployUrl: null,
      deployPort: null,
      lastActivityAt: new Date(),
    });
    return { ok: true, workspace: updated };
  }

  private async componentsWithFork(
    projectId: string,
    userId: string,
  ): Promise<Array<ProjectComponentRecord & { fork: ProjectForkRecord | null }>> {
    const components = await this.deps.components.listByProject(projectId);
    return Promise.all(
      components.map(async (component) => ({
        ...component,
        fork: await this.deps.forks.findByComponentAndUser(component.id, userId),
      })),
    );
  }

  /** A fork plus its workspace, for the caller polling fork status. */
  async getForkStatus(
    forkId: string,
  ): Promise<{ fork: ProjectForkRecord; workspace: ProjectWorkspaceRecord | null } | null> {
    const fork = await this.deps.forks.findById(forkId);
    if (!fork) return null;
    return { fork, workspace: await this.deps.workspaces.findById(fork.workspaceId) };
  }

  /**
   * The tier a fork runs at. A project may declare one explicitly; otherwise
   * the configured default (tier-2, a container workspace, ADR-20) applies —
   * never the tier-3 vcluster path, which is for cluster exercises rather than
   * project work.
   */
  private resolveTier(project: ProjectRecord): RuntimeTier {
    return routeTier({
      declaredTier: project.runtimeTier || this.deps.defaultTier,
      exerciseSlug: null,
    }).tier;
  }

  /**
   * The template a fork's workspace is built from. A component names either a
   * catalog slug or an existing workspace to copy (§1.3); a fork-your-own
   * component takes the template of the workspace it copies, falling back to
   * the bare base image when that workspace is gone.
   */
  private async resolveTemplateSlug(
    component: ProjectComponentRecord,
  ): Promise<string> {
    if (component.templateSlug) return component.templateSlug;
    if (component.templateWorkspaceId) {
      const source = await this.deps.workspaces.findById(component.templateWorkspaceId);
      if (source) return source.templateSlug;
    }
    return 'debian-base';
  }

  private async provision(
    workspace: ProjectWorkspaceRecord,
    fork: ProjectForkRecord,
    component: ProjectComponentRecord,
    tier: RuntimeTier,
  ): Promise<void> {
    const provider = this.deps.provider;
    if (!provider) return;

    const spec: LabSpec = {
      // The workspace is the durable unit; use its id as the session id so the
      // provider's namespace is stable across a stop/resume cycle.
      exercise_id: workspace.templateSlug,
      runtime_tier: tier,
      tenant_id: workspace.tenantId,
      user_id: workspace.userId,
      session_id: workspace.id,
      ttl_seconds: 1800,
      network_policy: 'allowlist',
    };

    try {
      const handle = await provider.provision(spec);
      await this.deps.workspaces.update(workspace.id, {
        status: this.workspaceStatus(handle),
        ideUrl: handle.ide_url ?? null,
        lastActivityAt: new Date(),
      });
    } catch (err) {
      // Surface the cause: a silent `failed` workspace is unactionable in ops.
      // eslint-disable-next-line no-console
      console.error(
        `[project-fork] provisioning failed for workspace ${workspace.id} (fork ${fork.id}, component ${component.id}):`,
        err instanceof Error ? `${err.name}: ${err.message}` : err,
      );
      await this.deps.workspaces.update(workspace.id, {
        status: 'failed',
        lastActivityAt: new Date(),
      });
    }
  }

  /** Map a provider session handle onto the workspace lifecycle. */
  private workspaceStatus(handle: SessionHandle): string {
    if (handle.status === 'ACTIVE') return 'running';
    if (handle.status === 'TERMINATED') return 'stopped';
    // WARM / IDLE: the environment exists but is not yet serving the IDE.
    return 'provisioning';
  }
}

/** Parse an ISO deadline, tolerating null/empty and rejecting bad input. */
export function parseDeadline(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
