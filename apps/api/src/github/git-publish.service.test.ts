import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GitPublishService, defaultRepoName } from './git-publish.service';
import { SecretBox } from '../crypto/secret-box';
import {
  InMemoryGitConnectionRepository,
  InMemoryGitPublishRepository,
  InMemoryProjectWorkspaceRepository,
} from '../common/in-memory';
import type { GitHubClient } from './github.client';

/** A fake GitHub client: no network, deterministic device flow and repos. */
function fakeGitHub(overrides: Partial<GitHubClient> = {}): GitHubClient {
  return {
    async startDeviceFlow() {
      return {
        deviceCode: 'dev-1',
        userCode: 'ABCD-1234',
        verificationUri: 'https://github.com/login/device',
        expiresIn: 900,
        interval: 5,
      };
    },
    async pollDeviceToken() {
      return { ok: true as const, token: 'gho_secret', scopes: 'repo' };
    },
    async getUser() {
      return { login: 'octocat' };
    },
    async ensureRepo(_token: string, name: string) {
      return {
        fullName: `octocat/${name}`,
        htmlUrl: `https://github.com/octocat/${name}`,
        cloneUrl: `https://github.com/octocat/${name}.git`,
        defaultBranch: 'main',
      };
    },
    async getRepo() {
      return null;
    },
    ...overrides,
  } as unknown as GitHubClient;
}

/** A fake provider that records the push it was asked to make. */
function fakePublisher(calls: unknown[]) {
  return {
    name: 'fake',
    async publish(input: unknown) {
      calls.push(input);
      return { repoUrl: (input as { remoteUrl: string }).remoteUrl };
    },
  };
}

async function fixture(
  overrides: {
    workspaceStatus?: string;
    github?: Partial<GitHubClient>;
    publisher?: boolean;
  } = {},
) {
  const connections = new InMemoryGitConnectionRepository();
  const publishes = new InMemoryGitPublishRepository();
  const workspaces = new InMemoryProjectWorkspaceRepository();
  const secretBox = new SecretBox('test-secret');
  const pushCalls: unknown[] = [];
  const svc = new GitPublishService({
    connections,
    publishes,
    workspaces,
    publisher: overrides.publisher === false ? null : fakePublisher(pushCalls),
    github: fakeGitHub(overrides.github),
    secretBox,
  });
  const workspace = await workspaces.create({
    tenantId: 't1',
    userId: 'u1',
    templateSlug: 'spring-boot',
    runtimeTier: 'tier_2_container',
    status: overrides.workspaceStatus ?? 'running',
    ideUrl: null,
    storageRef: null,
  });
  return { svc, connections, publishes, workspaces, secretBox, pushCalls, workspace };
}

test('status reports not connected before the student links GitHub', async () => {
  const { svc } = await fixture();
  assert.deepEqual(await svc.status('u1'), {
    connected: false,
    login: null,
    provider: 'github',
  });
});

test('connect stores the token encrypted, never in the clear', async () => {
  const { svc, connections } = await fixture();
  const start = await svc.connectStart();
  assert.ok(start.ok);
  const done = await svc.connectComplete('u1', 't1', 'dev-1');
  assert.ok(done.ok);
  assert.equal(done.connection.login, 'octocat');

  const row = await connections.findByUser('u1', 'github');
  assert.ok(row);
  assert.notEqual(row.tokenCiphertext, 'gho_secret');
  assert.ok(!row.tokenCiphertext.includes('gho_secret'));
});

test('connect reports a pending authorisation distinctly', async () => {
  const { svc } = await fixture({
    github: {
      async pollDeviceToken() {
        return { ok: false as const, reason: 'authorization_pending' as const };
      },
    } as Partial<GitHubClient>,
  });
  const result = await svc.connectComplete('u1', 't1', 'dev-1');
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, 'authorization_pending');
});

test('publish refuses when GitHub is not connected', async () => {
  const { svc, workspace } = await fixture();
  const result = await svc.publish({
    userId: 'u1',
    tenantId: 't1',
    workspaceId: workspace.id,
  });
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, 'not_connected');
});

test('publish refuses a workspace that is not running', async () => {
  const { svc, workspace } = await fixture({ workspaceStatus: 'stopped' });
  await svc.connectComplete('u1', 't1', 'dev-1');
  const result = await svc.publish({
    userId: 'u1',
    tenantId: 't1',
    workspaceId: workspace.id,
  });
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, 'workspace_not_running');
});

test('publish creates the repo, pushes, and records success', async () => {
  const { svc, publishes, pushCalls, workspace } = await fixture();
  await svc.connectComplete('u1', 't1', 'dev-1');

  const result = await svc.publish({
    userId: 'u1',
    tenantId: 't1',
    workspaceId: workspace.id,
  });
  assert.ok(result.ok);
  assert.equal(result.publish.status, 'succeeded');
  assert.equal(result.publish.repoFullName, 'octocat/tenxlab-spring-boot');

  // The push carried the decrypted token to the provider's push job.
  assert.equal(pushCalls.length, 1);
  const push = pushCalls[0] as { token: string; remoteUrl: string };
  assert.equal(push.token, 'gho_secret');
  assert.equal(push.remoteUrl, 'https://github.com/octocat/tenxlab-spring-boot.git');

  const history = await svc.history('u1', workspace.id);
  assert.equal(history.length, 1);
  assert.equal(history[0]?.status, 'succeeded');
  assert.equal((await publishes.listByWorkspace(workspace.id)).length, 1);
});

test('a failed push is recorded so the student sees why', async () => {
  const connections = new InMemoryGitConnectionRepository();
  const publishes = new InMemoryGitPublishRepository();
  const workspaces = new InMemoryProjectWorkspaceRepository();
  const svc = new GitPublishService({
    connections,
    publishes,
    workspaces,
    publisher: {
      name: 'fake',
      async publish() {
        throw new Error('remote rejected');
      },
    },
    github: fakeGitHub(),
    secretBox: new SecretBox('test-secret'),
  });
  const workspace = await workspaces.create({
    tenantId: 't1',
    userId: 'u1',
    templateSlug: 'spring-boot',
    runtimeTier: 'tier_2_container',
    status: 'running',
    ideUrl: null,
    storageRef: null,
  });
  await svc.connectComplete('u1', 't1', 'dev-1');
  const result = await svc.publish({
    userId: 'u1',
    tenantId: 't1',
    workspaceId: workspace.id,
  });
  assert.equal(result.ok, false);
  const rows = await publishes.listByWorkspace(workspace.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.status, 'failed');
  assert.match(rows[0]?.error ?? '', /remote rejected/);
});

test('publish is unavailable when no provider can push', async () => {
  const { svc, workspace } = await fixture({ publisher: false });
  await svc.connectComplete('u1', 't1', 'dev-1');
  const result = await svc.publish({
    userId: 'u1',
    tenantId: 't1',
    workspaceId: workspace.id,
  });
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, 'publish_unavailable');
});

test('history is empty for a workspace the caller does not own', async () => {
  const { svc, workspace } = await fixture();
  assert.deepEqual(await svc.history('someone-else', workspace.id), []);
});

test('defaultRepoName derives a safe slug from the template', () => {
  assert.equal(defaultRepoName('spring-boot'), 'tenxlab-spring-boot');
  assert.equal(defaultRepoName('C++ / STL'), 'tenxlab-c-stl');
  assert.equal(defaultRepoName(''), 'tenxlab-project');
});

test('SecretBox round-trips and rejects tampering', () => {
  const box = new SecretBox('key-1');
  const token = 'gho_secret_value';
  const encrypted = box.encrypt(token);
  assert.notEqual(encrypted, token);
  assert.equal(box.decrypt(encrypted), token);
  // A different key cannot read it.
  assert.throws(() => new SecretBox('key-2').decrypt(encrypted));
  // A truncated/garbled ciphertext is rejected rather than returning garbage.
  assert.throws(() => box.decrypt('v1.not.a.token'));
});
