import type { LabSpec, RuntimeTier, SessionHandle } from '@tenxlab/contracts';
import type { LabProvider } from '@tenxlab/lab-provider';
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
