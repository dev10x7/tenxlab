import type { LabSpec, RuntimeTier, SessionHandle } from '@tenxlab/contracts';
import {
  composeIdeUrl,
  type LabProvider,
  type ServiceExposer,
  type Suspendable,
  type WorkspaceArchiver,
} from '@tenxlab/lab-provider';
import { routeTier, checkStorageQuota, forkStorageGb } from '@tenxlab/runtime-policy';
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
  TenantRepository,
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

export type DownloadResult =
  | { ok: true; archive: Uint8Array }
  | { ok: false; reason: DownloadFailureReason; message: string };

export type DownloadFailureReason =
  | 'workspace_not_found'
  | 'workspace_not_running'
  | 'download_unavailable'
  | 'download_empty'
  | 'download_failed';

export type DeleteResult =
  | { ok: true; workspaceId: string }
  | { ok: false; reason: 'workspace_not_found'; message: string };

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
  | 'membership_required'
  | 'storage_exceeded';

export interface ForkDeps {
  projects: ProjectRepository;
  components: ProjectComponentRepository;
  workspaces: ProjectWorkspaceRepository;
  forks: ProjectForkRepository;
  memberships: MembershipRepository;
  /** Tenant plan limits; optional so a fork-only test can omit the quota gate. */
  tenants?: TenantRepository;
  /** Null disables real provisioning (unit tests, catalog-only deployments). */
  provider?: LabProvider | null;
  /**
   * Publishes a running workspace's service on a public URL (E5). Null disables
   * Deploy, exactly as a null `provider` disables forking.
   */
  exposer?: ServiceExposer | null;
  /**
   * Exports a workspace's files as a tar for download (Nov'25 §1.5). Null
   * disables Download, exactly as a null `provider` disables forking.
   */
  archiver?: WorkspaceArchiver | null;
  /** Default runtime tier for a fork when the project declares none. */
  defaultTier?: RuntimeTier;
  /**
   * Public base that fronts per-session IDE ingress hosts. The browser-facing
   * `ideUrl` is composed from a workspace's stored host plus this base on every
   * read, so changing it applies to existing workspaces too.
   */
  idePublicBaseUrl?: string;
  /** Scheme for IDE URLs when no public base is configured. */
  ideScheme?: 'https' | 'http';
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
      const found = await this.deps.workspaces.findById(existing.workspaceId);
      // Repair a stale `running` row first: a rebuilt cluster leaves the row
      // claiming `running` while the workload is gone, so a plain re-attach
      // would hand back a dead IDE URL. Reconciling turns it into `failed`,
      // which the branch below then re-provisions.
      const workspace = found ? await this.reconcile(found) : null;
      // Re-forking a stopped or failed workspace brings it back: a stopped one
      // resumes from its surviving volume, a failed one re-provisions against
      // the same id, rather than re-attaching to a dead environment.
      if (
        workspace &&
        (workspace.status === 'stopped' || workspace.status === 'failed') &&
        this.deps.provider
      ) {
        // Capture the pre-resume status before update(): repositories may mutate
        // the row in place, so `workspace.status` is not reliable afterwards.
        const resumable = workspace.status === 'stopped';
        const resumed = await this.deps.workspaces.update(workspace.id, {
          status: 'provisioning',
          ideHost: null,
          lastActivityAt: new Date(),
        });
        // A suspendable provider (ADR-20) kept the volume and only scaled the
        // workload down, so resuming a *stopped* workspace is a scale-up.
        // A *failed* workspace may have no namespace at all (provisioning died
        // before creating one, or the cluster was rebuilt), so it always
        // re-provisions: the provider's applies are idempotent, which repairs a
        // half-built environment rather than patching a Deployment that is gone.
        const suspender = resumable ? suspendable(this.deps.provider) : null;
        if (suspender) {
          void this.resume(resumed).catch(() => {
            // resume() records a failed scale-up on the workspace row.
          });
        } else {
          void this.provision(resumed, existing, component, tier).catch(() => {
            // provision() records the failure on the workspace row.
          });
        }
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
        ideUrl: workspace ? this.ideUrlFor(workspace) : null,
      };
    }

    // Storage is a fork-only cost dimension (ADR-20): a tenant's forks each hold
    // a durable volume, so a *new* fork must fit under the tenant's storage
    // ceiling. Re-attaching to or resuming an existing fork adds no volume, so it
    // is checked above this point and never gated.
    const quotaFailure = await this.enforceStorageQuota(req.tenantId, tier);
    if (quotaFailure) return quotaFailure;

    const workspace = await this.deps.workspaces.create({
      tenantId: req.tenantId,
      userId: req.userId,
      templateSlug: await this.resolveTemplateSlug(component),
      runtimeTier: tier,
      status: 'provisioning',
      ideHost: null,
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
   * Stop a fork's workspace so it can be submitted. The compute is torn down but
   * the durable volume is kept, so the files survive — `stopped`, not `failed`.
   * Required before submit (ByteXL stops the session first, §1.2).
   *
   * A provider that can suspend (ADR-20) scales the workload to zero and keeps
   * the volume, which is what makes stop-when-idle cheap: a re-fork scales back
   * up rather than rebuilding. A provider that cannot suspend is torn down; its
   * volume is still assumed durable.
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
    const suspender = suspendable(this.deps.provider);
    if (suspender) {
      try {
        await suspender.suspend(workspace.id);
      } catch {
        // The workload may already be scaled down; the volume is untouched, so
        // a failed suspend still leaves the workspace stoppable.
      }
    } else if (this.deps.provider) {
      try {
        await this.deps.provider.terminate(workspace.id);
      } catch {
        // The provider may already be gone; the durable volume is untouched, so
        // a failed terminate still leaves the workspace stoppable.
      }
    }
    const stopped = await this.deps.workspaces.update(workspace.id, {
      status: 'stopped',
      ideHost: null,
      // A stop tears the compute down, so any exposed service is gone with it.
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

  /**
   * Permanently delete a workspace and its fork (ByteXL's "delete" quick
   * action, Nov'25 §1.5).
   *
   * Unlike Stop (which keeps the durable volume), Delete is destructive: the
   * compute is terminated, the volume released, and the fork row removed so the
   * component becomes forkable again. A submission that referenced the workspace
   * keeps its own row (the FK is by id, not cascade from the workspace), so an
   * already-evaluated submission survives its workspace.
   */
  async deleteWorkspace(userId: string, workspaceId: string): Promise<DeleteResult> {
    const workspace = await this.deps.workspaces.findById(workspaceId);
    if (!workspace || workspace.userId !== userId) {
      return { ok: false, reason: 'workspace_not_found', message: 'Workspace not found' };
    }
    if (this.deps.provider) {
      try {
        await this.deps.provider.terminate(workspace.id);
      } catch {
        // The workload may already be gone; the rows are still cleared so the
        // component is forkable again.
      }
    }
    // Remove the fork first: it holds the FK to the workspace.
    const fork = await this.deps.forks.findByWorkspaceId(workspaceId);
    if (fork) await this.deps.forks.delete(fork.id);
    await this.deps.workspaces.delete(workspaceId);
    return { ok: true, workspaceId };
  }

  /**
   * Export the workspace's files as a tar archive (ByteXL's "download
   * workspace" quick action, Nov'25 §1.5).
   *
   * Like Deploy, this is a running-workspace concern: the volume is mounted only
   * while the workload runs, so a stopped fork must be resumed first. The
   * provider returns the tar bytes; the controller streams them to the student.
   */
  async download(userId: string, workspaceId: string): Promise<DownloadResult> {
    const workspace = await this.deps.workspaces.findById(workspaceId);
    if (!workspace || workspace.userId !== userId) {
      return { ok: false, reason: 'workspace_not_found', message: 'Workspace not found' };
    }
    if (workspace.status !== 'running') {
      return {
        ok: false,
        reason: 'workspace_not_running',
        message: 'Start the workspace before downloading its files',
      };
    }
    const archiver = this.deps.archiver;
    if (!archiver) {
      return {
        ok: false,
        reason: 'download_unavailable',
        message: 'Workspace download is not available in this deployment',
      };
    }
    try {
      const archive = await archiver.archiveWorkspaceFiles({ sessionId: workspace.id });
      if (!archive || archive.length === 0) {
        return {
          ok: false,
          reason: 'download_empty',
          message: 'This workspace has no files to download yet',
        };
      }
      return { ok: true, archive };
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(
        `[project-download] archive failed for workspace ${workspace.id}:`,
        err instanceof Error ? `${err.name}: ${err.message}` : err,
      );
      return {
        ok: false,
        reason: 'download_failed',
        message: 'Could not prepare the workspace download. Please try again.',
      };
    }
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

  /**
   * The browser-facing IDE URL for a workspace, composed from its stored ingress
   * host plus the *current* public base. Derived on every read so a base-URL
   * change applies to existing workspaces rather than only future ones.
   */
  ideUrlFor(workspace: ProjectWorkspaceRecord): string | null {
    return composeIdeUrl(workspace.ideHost, {
      publicIdeBaseUrl: this.deps.idePublicBaseUrl,
      ideScheme: this.deps.ideScheme,
    });
  }

  /** A fork plus its workspace, for the caller polling fork status. */
  async getForkStatus(
    forkId: string,
  ): Promise<{ fork: ProjectForkRecord; workspace: ProjectWorkspaceRecord | null } | null> {
    const fork = await this.deps.forks.findById(forkId);
    if (!fork) return null;
    const workspace = await this.deps.workspaces.findById(fork.workspaceId);
    return { fork, workspace: workspace ? await this.reconcile(workspace) : null };
  }

  /**
   * Repair a `running` workspace against the execution plane on read.
   *
   * A workspace row outlives the cluster it describes. A rebuilt cluster (or a
   * namespace reaped out of band) leaves the row claiming `running` with an
   * `ideHost`, so the student's "Open workspace" link resolves to an ingress
   * with no matching rule and returns a bare 404. The row is the only durable
   * record of the workspace, so the read path repairs it: when the provider no
   * longer knows the workspace, the row is flipped to `failed` and its host
   * cleared.
   *
   * Only `running` is reconciled. A `provisioning` row may still be in flight,
   * and a `stopped` row legitimately has no running compute (its volume is the
   * promise; a re-fork resumes or re-provisions it). A provider error leaves the
   * row untouched — a transient control-plane blip must not condemn a healthy
   * workspace.
   */
  private async reconcile(
    workspace: ProjectWorkspaceRecord,
  ): Promise<ProjectWorkspaceRecord> {
    if (workspace.status !== 'running') return workspace;
    const provider = this.deps.provider;
    if (!provider) return workspace;
    let handle: SessionHandle | null;
    try {
      handle = await provider.status(workspace.id);
    } catch {
      return workspace;
    }
    if (handle) return workspace;
    // eslint-disable-next-line no-console
    console.warn(
      `[project-fork] workspace ${workspace.id} is gone from the execution plane; marking failed`,
    );
    return this.deps.workspaces.update(workspace.id, {
      status: 'failed',
      ideHost: null,
      lastActivityAt: new Date(),
    });
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

  /**
   * Scale a suspended fork's workload back up (ADR-20). The volume survived the
   * stop, so the IDE comes back on the same URL; a failure is recorded as
   * `failed` so ops can see the scale-up did not land.
   */
  private async resume(workspace: ProjectWorkspaceRecord): Promise<void> {
    const suspender = suspendable(this.deps.provider);
    if (!suspender) return;
    try {
      await suspender.resume(workspace.id);
      // `stop` nulls `ideHost`; the resumed workload reuses the same ingress,
      // so re-read the provider to restore it instead of leaving the card
      // without an "Open workspace" link until the next re-fork.
      const handle = await this.deps.provider?.status(workspace.id);
      await this.deps.workspaces.update(workspace.id, {
        status: 'running',
        ideHost: handle?.ide_host ?? workspace.ideHost ?? null,
        lastActivityAt: new Date(),
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(
        `[project-fork] resume failed for workspace ${workspace.id}:`,
        err instanceof Error ? `${err.name}: ${err.message}` : err,
      );
      await this.deps.workspaces.update(workspace.id, {
        status: 'failed',
        lastActivityAt: new Date(),
      });
    }
  }

  /**
   * The storage gate for a new fork (ADR-20). The tenant's ceiling is 0 (or
   * unset) for unlimited. A tenant that is over its ceiling gets a fork failure
   * the caller can surface, rather than a silently leaking volume. A deployment
   * with no tenant repository (a fork-only test) skips the gate.
   */
  private async enforceStorageQuota(
    tenantId: string,
    tier: RuntimeTier,
  ): Promise<{ ok: false; reason: ForkFailureReason; message: string } | null> {
    if (!this.deps.tenants) return null;
    const tenant = await this.deps.tenants.findById(tenantId);
    if (!tenant) return null;
    const decision = checkStorageQuota(
      { maxConcurrentLabs: tenant.maxConcurrentLabs, monthlyBudgetCents: tenant.monthlyBudgetCents, maxStorageGb: tenant.maxStorageGb ?? 0 },
      // Each fork holds one volume of the tier's size.
      (await this.deps.workspaces.countByTenant(tenantId)) * forkStorageGb(tier),
      forkStorageGb(tier),
    );
    return decision.allowed
      ? null
      : { ok: false, reason: 'storage_exceeded', message: decision.message };
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
        // Persist the stable host, never the composed URL (see `ideUrlFor`).
        ideHost: handle.ide_host ?? null,
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

/** Structural check: can this provider suspend/resume a fork's compute? */
function suspendable(
  provider: LabProvider | null | undefined,
): Suspendable | null {
  const candidate = provider as Partial<Suspendable> | null | undefined;
  return candidate &&
    typeof candidate.suspend === 'function' &&
    typeof candidate.resume === 'function'
    ? (candidate as Suspendable)
    : null;
}
