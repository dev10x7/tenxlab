import type { GitPublisher } from '@tenxlab/lab-provider';
import type {
  GitConnectionRepository,
  GitConnectionRecord,
  GitPublishRecord,
  GitPublishRepository,
  ProjectWorkspaceRepository,
} from '../common/ports';
import type { SecretBox } from '../crypto/secret-box';
import { GitHubClient, GitHubError, type DeviceCodeGrant } from './github.client';

export interface GitPublishDeps {
  connections: GitConnectionRepository;
  publishes: GitPublishRepository;
  workspaces: ProjectWorkspaceRepository;
  /** The provider seam that can push a workspace; null when none is wired. */
  publisher: GitPublisher | null;
  github: GitHubClient;
  secretBox: SecretBox;
}

export interface GitStatusView {
  connected: boolean;
  login: string | null;
  provider: string;
}

export type ConnectStartResult =
  | { ok: true; grant: DeviceCodeGrant }
  | { ok: false; reason: 'not_configured'; message: string };

export type ConnectCompleteResult =
  | { ok: true; connection: GitStatusView }
  | { ok: false; reason: 'authorization_pending' | 'expired' | 'denied' | 'error'; message: string };

export type GitPublishFailure =
  | 'not_connected'
  | 'workspace_not_found'
  | 'workspace_not_running'
  | 'publish_unavailable'
  | 'publish_failed';

export type GitPublishOutcome =
  | { ok: true; publish: GitPublishRecord }
  | { ok: false; reason: GitPublishFailure; message: string };

const PROVIDER = 'github';

/**
 * Git publish (ByteXL's IDE Source Control push).
 *
 * The student connects their GitHub account once via the OAuth device flow; the
 * access token is stored encrypted. Publishing then creates (or reuses) a repo
 * on their account and has the lab provider push the workspace volume to it, so
 * the code lands in the student's own GitHub rather than ours. The LMS holds the
 * token only long enough to hand it to the provider's push job.
 */
export class GitPublishService {
  constructor(private readonly deps: GitPublishDeps) {}

  /** The caller's GitHub connection state, for the Nimbus UI. */
  async status(userId: string): Promise<GitStatusView> {
    const connection = await this.deps.connections.findByUser(userId, PROVIDER);
    return { connected: connection !== null, login: connection?.login ?? null, provider: PROVIDER };
  }

  /** Begin a device-flow connection. The student types the user code at GitHub. */
  async connectStart(): Promise<ConnectStartResult> {
    if (!this.deps.github) {
      return { ok: false, reason: 'not_configured', message: 'GitHub is not configured' };
    }
    const grant = await this.deps.github.startDeviceFlow();
    return { ok: true, grant };
  }

  /** Finish a device-flow connection once the student has approved the code. */
  async connectComplete(
    userId: string,
    tenantId: string,
    deviceCode: string,
  ): Promise<ConnectCompleteResult> {
    const result = await this.deps.github.pollDeviceToken(deviceCode);
    if (!result.ok) {
      if (result.reason === 'authorization_pending' || result.reason === 'slow_down') {
        return { ok: false, reason: 'authorization_pending', message: 'Waiting for you to approve the code on GitHub' };
      }
      if (result.reason === 'expired_token') {
        return { ok: false, reason: 'expired', message: 'The code expired. Start again.' };
      }
      if (result.reason === 'access_denied') {
        return { ok: false, reason: 'denied', message: 'You declined the GitHub authorisation.' };
      }
      return { ok: false, reason: 'error', message: 'GitHub sign-in failed. Please try again.' };
    }

    const user = await this.deps.github.getUser(result.token);
    await this.deps.connections.upsert({
      tenantId,
      userId,
      provider: PROVIDER,
      login: user.login,
      tokenCiphertext: this.deps.secretBox.encrypt(result.token),
      scopes: result.scopes,
    });
    return { ok: true, connection: { connected: true, login: user.login, provider: PROVIDER } };
  }

  /** Disconnect the caller's GitHub account, discarding the stored token. */
  async disconnect(userId: string): Promise<void> {
    await this.deps.connections.delete(userId, PROVIDER);
  }

  /**
   * Publish a running workspace to the student's GitHub. Creates the repo if
   * needed, pushes the workspace, and records the result. A failed push is
   * recorded (so the student sees why) and reported, never silently dropped.
   */
  async publish(
    input: { userId: string; tenantId: string; workspaceId: string; repoName?: string; branch?: string },
  ): Promise<GitPublishOutcome> {
    const connection = await this.deps.connections.findByUser(input.userId, PROVIDER);
    if (!connection) {
      return {
        ok: false,
        reason: 'not_connected',
        message: 'Connect your GitHub account before publishing.',
      };
    }
    const workspace = await this.deps.workspaces.findById(input.workspaceId);
    if (!workspace || workspace.userId !== input.userId) {
      return { ok: false, reason: 'workspace_not_found', message: 'Workspace not found' };
    }
    if (workspace.status !== 'running') {
      return {
        ok: false,
        reason: 'workspace_not_running',
        message: 'Start the workspace before publishing to GitHub.',
      };
    }
    if (!this.deps.publisher) {
      return {
        ok: false,
        reason: 'publish_unavailable',
        message: 'Publishing is not available right now.',
      };
    }

    const token = this.deps.secretBox.decrypt(connection.tokenCiphertext);
    const branch = input.branch || 'main';
    const repoName = input.repoName?.trim() || defaultRepoName(workspace.templateSlug);

    let repo;
    try {
      repo = await this.deps.github.ensureRepo(token, repoName, {
        description: `Published from TenXLab (${workspace.templateSlug})`,
      });
    } catch (err) {
      const message =
        err instanceof GitHubError && err.status === 401
          ? 'Your GitHub authorisation expired. Reconnect your account.'
          : 'Could not create the GitHub repository. Please try again.';
      await this.deps.publishes.create({
        tenantId: input.tenantId,
        userId: input.userId,
        workspaceId: workspace.id,
        repoFullName: repoName,
        repoUrl: '',
        branch,
        status: 'failed',
        commitSha: null,
        error: message,
      });
      return { ok: false, reason: 'publish_failed', message };
    }

    try {
      await this.deps.publisher.publish({
        sessionId: workspace.id,
        remoteUrl: repo.cloneUrl,
        branch,
        token,
        message: 'Publish from TenXLab',
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'The push to GitHub failed. Please try again.';
      await this.deps.publishes.create({
        tenantId: input.tenantId,
        userId: input.userId,
        workspaceId: workspace.id,
        repoFullName: repo.fullName,
        repoUrl: repo.htmlUrl,
        branch,
        status: 'failed',
        commitSha: null,
        error: message,
      });
      return { ok: false, reason: 'publish_failed', message };
    }

    const publish = await this.deps.publishes.create({
      tenantId: input.tenantId,
      userId: input.userId,
      workspaceId: workspace.id,
      repoFullName: repo.fullName,
      repoUrl: repo.htmlUrl,
      branch,
      status: 'succeeded',
      commitSha: null,
      error: null,
    });
    return { ok: true, publish };
  }

  /** The caller's publish history for a workspace, newest first. */
  async history(userId: string, workspaceId: string): Promise<GitPublishRecord[]> {
    const workspace = await this.deps.workspaces.findById(workspaceId);
    if (!workspace || workspace.userId !== userId) return [];
    return this.deps.publishes.listByWorkspace(workspaceId);
  }
}

/** Derive a repo name from a workspace template, e.g. `spring-boot-…`. */
export function defaultRepoName(templateSlug: string): string {
  const base = templateSlug.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `tenxlab-${base || 'project'}`;
}

export type { GitConnectionRecord };
