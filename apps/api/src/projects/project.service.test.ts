import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { LabSpec, SessionHandle } from '@tenxlab/contracts';
import type { LabProvider, ServiceExposer, WorkspaceArchiver } from '@tenxlab/lab-provider';
import { ProjectService } from './project.service';
import {
  InMemoryMembershipRepository,
  InMemoryProjectComponentRepository,
  InMemoryProjectForkRepository,
  InMemoryProjectRepository,
  InMemoryProjectWorkspaceRepository,
  InMemoryTenantRepository,
} from '../common/in-memory';
import type {
  ProjectComponentRecord,
  ProjectRecord,
  TenantRecord,
} from '../common/ports';

const PROJECT: ProjectRecord = {
  id: 'p1',
  tenantId: 't1',
  title: 'Build an API',
  description: '',
  runtimeTier: 'tier_2_container',
  status: 'published',
  deadline: null,
  maxScore: 100,
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

const COMPONENT: ProjectComponentRecord = {
  id: 'c1',
  tenantId: 't1',
  projectId: 'p1',
  title: 'REST API',
  technology: 'spring-boot',
  templateSlug: 'spring-boot',
  templateWorkspaceId: null,
  position: 0,
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

function fixture(
  overrides: {
    project?: Partial<ProjectRecord>;
    provider?: LabProvider | null;
    exposer?: ServiceExposer | null;
    archiver?: WorkspaceArchiver | null;
    tenant?: Partial<TenantRecord> | null;
    idePublicBaseUrl?: string;
  } = {},
) {
  const projects = new InMemoryProjectRepository([{ ...PROJECT, ...overrides.project }]);
  const components = new InMemoryProjectComponentRepository([{ ...COMPONENT }]);
  const workspaces = new InMemoryProjectWorkspaceRepository();
  const forks = new InMemoryProjectForkRepository();
  const memberships = new InMemoryMembershipRepository([
    { id: 'm1', userId: 'u1', tenantId: 't1', role: 'student', status: 'active' },
  ]);
  const tenants =
    overrides.tenant === null
      ? undefined
      : new InMemoryTenantRepository([
          {
            id: 't1',
            name: 'Acme',
            domain: 'acme',
            maxConcurrentLabs: 50,
            monthlyBudgetCents: 0,
            maxStorageGb: 0,
            plan: 'standard',
            status: 'active',
            ...overrides.tenant,
          },
        ]);
  const svc = new ProjectService({
    projects,
    components,
    workspaces,
    forks,
    memberships,
    tenants,
    provider: overrides.provider ?? null,
    exposer: overrides.exposer ?? null,
    archiver: overrides.archiver ?? null,
    defaultTier: 'tier_2_container',
    idePublicBaseUrl: overrides.idePublicBaseUrl,
  });
  return { svc, projects, components, workspaces, forks, memberships, tenants };
}

function fakeProvider(handle?: Partial<SessionHandle>): {
  provider: LabProvider;
  specs: LabSpec[];
} {
  const specs: LabSpec[] = [];
  const provider: LabProvider = {
    name: 'fake',
    async provision(spec) {
      specs.push(spec);
      return {
        session_id: spec.session_id,
        status: 'ACTIVE',
        tier: spec.runtime_tier,
        ide_host: 'ide.example.com',
        ide_url: 'https://ide.example.com/ws',
        provider_ref: `ns-${spec.session_id}`,
        started_at: new Date().toISOString(),
        last_activity_at: new Date().toISOString(),
        ttl_seconds: spec.ttl_seconds,
        ...handle,
      };
    },
    async status(sessionId: string) {
      return {
        session_id: sessionId,
        status: 'ACTIVE',
        tier: 'tier_2_container',
        ide_host: 'ide.example.com',
        ide_url: 'https://ide.example.com/ws',
        provider_ref: `ns-${sessionId}`,
        started_at: new Date().toISOString(),
        last_activity_at: new Date().toISOString(),
        ttl_seconds: 1800,
      };
    },
    async heartbeat() {
      throw new Error('not used');
    },
    async terminate() {},
  };
  return { provider, specs };
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('waitFor timed out');
}

test('fork creates a workspace and fork row and returns immediately', async () => {
  const { svc, workspaces, forks } = fixture();
  const res = await svc.fork({ userId: 'u1', tenantId: 't1', projectId: 'p1', componentId: 'c1' });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.tier, 'tier_2_container');
  assert.equal(res.status, 'provisioning');
  assert.equal(res.ideUrl, null);

  const workspace = await workspaces.findById(res.workspaceId);
  assert.equal(workspace?.templateSlug, 'spring-boot');
  assert.equal(workspace?.userId, 'u1');
  const fork = await forks.findById(res.forkId);
  assert.equal(fork?.componentId, 'c1');
  assert.equal(fork?.sourceTemplateSlug, 'spring-boot');
  assert.equal(fork?.workspaceId, res.workspaceId);
});

test('fork provisions through the provider and records the IDE URL', async () => {
  const { provider, specs } = fakeProvider();
  const { svc, workspaces } = fixture({ provider });
  const res = await svc.fork({ userId: 'u1', tenantId: 't1', projectId: 'p1', componentId: 'c1' });
  assert.equal(res.ok, true);
  if (!res.ok) return;

  await waitFor(async () => (await workspaces.findById(res.workspaceId))?.status === 'running');
  const workspace = await workspaces.findById(res.workspaceId);
  assert.equal(workspace?.status, 'running');
  // Only the stable host is persisted; the URL is composed at read time.
  assert.equal(workspace?.ideHost, 'ide.example.com');
  assert.equal(svc.ideUrlFor(workspace!), 'https://ide.example.com/');
  assert.equal(specs.length, 1);
  assert.equal(specs[0]?.exercise_id, 'spring-boot');
  assert.equal(specs[0]?.session_id, res.workspaceId);
  assert.equal(specs[0]?.runtime_tier, 'tier_2_container');
});

test('a failed provision is recorded as failed, never stopped', async () => {
  const provider = {
    name: 'boom',
    async provision(): Promise<SessionHandle> {
      throw new Error('cluster exploded');
    },
  } as unknown as LabProvider;
  const { svc, workspaces } = fixture({ provider });
  const res = await svc.fork({ userId: 'u1', tenantId: 't1', projectId: 'p1', componentId: 'c1' });
  assert.equal(res.ok, true);
  if (!res.ok) return;

  await waitFor(async () => (await workspaces.findById(res.workspaceId))?.status === 'failed');
  const workspace = await workspaces.findById(res.workspaceId);
  assert.equal(workspace?.status, 'failed');
  // `failed` must not promise the files survived.
  assert.equal(workspace?.storageRef, null);
});

test('re-forking re-attaches to the existing workspace instead of leaking one', async () => {
  const { svc, workspaces } = fixture();
  const first = await svc.fork({ userId: 'u1', tenantId: 't1', projectId: 'p1', componentId: 'c1' });
  const second = await svc.fork({ userId: 'u1', tenantId: 't1', projectId: 'p1', componentId: 'c1' });
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  if (!first.ok || !second.ok) return;
  assert.equal(second.forkId, first.forkId);
  assert.equal(second.workspaceId, first.workspaceId);
  assert.equal((await workspaces.listByUser('t1', 'u1')).length, 1);
});

test('re-forking a stopped workspace resumes it instead of attaching to a dead one', async () => {
  const { provider, specs } = fakeProvider();
  const { svc, workspaces } = fixture({ provider });

  const first = await svc.fork({ userId: 'u1', tenantId: 't1', projectId: 'p1', componentId: 'c1' });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  await waitFor(async () => (await workspaces.findById(first.workspaceId))?.status === 'running');

  const stopped = await svc.stopWorkspace('u1', first.workspaceId);
  assert.equal(stopped.ok, true);
  assert.equal((await workspaces.findById(first.workspaceId))?.status, 'stopped');

  const resumed = await svc.fork({ userId: 'u1', tenantId: 't1', projectId: 'p1', componentId: 'c1' });
  assert.equal(resumed.ok, true);
  if (!resumed.ok) return;
  assert.equal(resumed.forkId, first.forkId);
  assert.equal(resumed.workspaceId, first.workspaceId);
  assert.equal(resumed.status, 'provisioning');

  await waitFor(async () => (await workspaces.findById(first.workspaceId))?.status === 'running');
  // Two provisions: the initial fork and the resume.
  assert.equal(specs.length, 2);
  assert.equal((await workspaces.listByUser('t1', 'u1')).length, 1);
});

test('fork rejects a draft project', async () => {
  const { svc } = fixture({ project: { status: 'draft' } });
  const res = await svc.fork({ userId: 'u1', tenantId: 't1', projectId: 'p1', componentId: 'c1' });
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.reason, 'project_not_published');
});

test('fork rejects an unknown project or component', async () => {
  const { svc } = fixture();
  const noProject = await svc.fork({ userId: 'u1', tenantId: 't1', projectId: 'nope', componentId: 'c1' });
  assert.equal(noProject.ok, false);
  if (!noProject.ok) assert.equal(noProject.reason, 'project_not_found');

  const noComponent = await svc.fork({ userId: 'u1', tenantId: 't1', projectId: 'p1', componentId: 'nope' });
  assert.equal(noComponent.ok, false);
  if (!noComponent.ok) assert.equal(noComponent.reason, 'component_not_found');
});

test('fork requires an active membership', async () => {
  const { svc, workspaces } = fixture();
  const res = await svc.fork({ userId: 'stranger', tenantId: 't1', projectId: 'p1', componentId: 'c1' });
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.reason, 'membership_required');
  assert.equal((await workspaces.listByUser('t1', 'stranger')).length, 0);
});

test('a fork-your-own component copies the source workspace template', async () => {
  const { svc, components, workspaces } = fixture();
  const source = await workspaces.create({
    tenantId: 't1',
    userId: 'u2',
    templateSlug: 'python-flask',
    runtimeTier: 'tier_2_container',
    status: 'stopped',
    ideHost: null,
    storageRef: 'vol-src',
  });
  const component = await components.create({
    tenantId: 't1',
    projectId: 'p1',
    title: 'Fork my own',
    technology: 'python',
    templateSlug: null,
    templateWorkspaceId: source.id,
    position: 1,
  });

  const res = await svc.fork({ userId: 'u1', tenantId: 't1', projectId: 'p1', componentId: component.id });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  const forkWorkspace = await workspaces.findById(res.workspaceId);
  assert.equal(forkWorkspace?.templateSlug, 'python-flask');
});

test('getForkStatus returns the fork with its workspace', async () => {
  const { svc } = fixture();
  const res = await svc.fork({ userId: 'u1', tenantId: 't1', projectId: 'p1', componentId: 'c1' });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  const status = await svc.getForkStatus(res.forkId);
  assert.equal(status?.fork.id, res.forkId);
  assert.equal(status?.workspace?.id, res.workspaceId);
  assert.equal(await svc.getForkStatus('missing'), null);
});

// ------------------------------------------------------------- deploy (E5)

function fakeExposer(options: { fail?: boolean } = {}): {
  exposer: ServiceExposer;
  calls: Array<{ sessionId: string; port: number }>;
  unexposed: string[];
} {
  const calls: Array<{ sessionId: string; port: number }> = [];
  const unexposed: string[] = [];
  const exposer: ServiceExposer = {
    name: 'fake',
    async expose(input) {
      if (options.fail) throw new Error('boom');
      calls.push(input);
      return { url: `https://demo.example.com/${input.sessionId}`, port: input.port };
    },
    async unexpose(sessionId) {
      unexposed.push(sessionId);
    },
  };
  return { exposer, calls, unexposed };
}

/** Seed a running workspace owned by `userId`. */
async function runningWorkspace(
  workspaces: ReturnType<typeof fixture>['workspaces'],
  userId = 'u1',
) {
  const w = await workspaces.create({
    tenantId: 't1',
    userId,
    templateSlug: 'spring-boot',
    runtimeTier: 'tier_2_container',
    status: 'running',
    ideHost: 'ide.example.com',
    storageRef: null,
  });
  return w;
}

/** A fork row pointing at an existing workspace, for the reconcile tests. */
async function seedFork(
  fx: ReturnType<typeof fixture>,
  workspaceId: string,
) {
  return fx.forks.create({
    projectId: 'p1',
    componentId: 'c1',
    tenantId: 't1',
    userId: 'u1',
    workspaceId,
    sourceTemplateSlug: 'spring-boot',
    sourceWorkspaceId: null,
  });
}

test('deploy exposes a running workspace and records its URL and port', async () => {
  const { exposer, calls } = fakeExposer();
  const fx = fixture({ exposer });
  const w = await runningWorkspace(fx.workspaces);
  const res = await fx.svc.deploy('u1', w.id, 5000);
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.workspace.deployUrl, `https://demo.example.com/${w.id}`);
  assert.equal(res.workspace.deployPort, 5000);
  assert.deepEqual(calls, [{ sessionId: w.id, port: 5000 }]);
});

test('deploy rejects a workspace that is not running', async () => {
  const fx = fixture({ exposer: fakeExposer().exposer });
  const w = await fx.workspaces.create({
    tenantId: 't1',
    userId: 'u1',
    templateSlug: 'spring-boot',
    runtimeTier: 'tier_2_container',
    status: 'stopped',
    ideHost: null,
    storageRef: null,
  });
  const res = await fx.svc.deploy('u1', w.id, 5000);
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.equal(res.reason, 'workspace_not_running');
});

test('deploy rejects a workspace owned by another user', async () => {
  const fx = fixture({ exposer: fakeExposer().exposer });
  const w = await runningWorkspace(fx.workspaces, 'someone-else');
  const res = await fx.svc.deploy('u1', w.id, 5000);
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.equal(res.reason, 'workspace_not_found');
});

test('deploy reports unavailable when no exposer is configured', async () => {
  const fx = fixture();
  const w = await runningWorkspace(fx.workspaces);
  const res = await fx.svc.deploy('u1', w.id, 5000);
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.equal(res.reason, 'deploy_unavailable');
});

test('a provider error during deploy is reported, not thrown', async () => {
  const fx = fixture({ exposer: fakeExposer({ fail: true }).exposer });
  const w = await runningWorkspace(fx.workspaces);
  const res = await fx.svc.deploy('u1', w.id, 5000);
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.equal(res.reason, 'deploy_failed');
  const row = await fx.workspaces.findById(w.id);
  assert.equal(row?.deployUrl, null);
});

test('undeploy withdraws the service and clears the record', async () => {
  const fake = fakeExposer();
  const fx = fixture({ exposer: fake.exposer });
  const w = await runningWorkspace(fx.workspaces);
  await fx.svc.deploy('u1', w.id, 5000);
  const res = await fx.svc.undeploy('u1', w.id);
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.workspace.deployUrl, null);
  assert.equal(res.workspace.deployPort, null);
  assert.deepEqual(fake.unexposed, [w.id]);
});

test('stopping a workspace clears its deployment', async () => {
  const fx = fixture({ exposer: fakeExposer().exposer });
  const w = await runningWorkspace(fx.workspaces);
  await fx.svc.deploy('u1', w.id, 5000);
  const stopped = await fx.svc.stopWorkspace('u1', w.id);
  assert.equal(stopped.ok, true);
  if (!stopped.ok) return;
  assert.equal(stopped.workspace.deployUrl, null);
  assert.equal(stopped.workspace.deployPort, null);
});

// ----------------------------------------------------------- download (E6)

function fakeArchiver(options: { fail?: boolean; empty?: boolean } = {}): {
  archiver: WorkspaceArchiver;
  calls: string[];
} {
  const calls: string[] = [];
  const archiver: WorkspaceArchiver = {
    name: 'fake',
    async archiveWorkspaceFiles(input) {
      calls.push(input.sessionId);
      if (options.fail) throw new Error('boom');
      if (options.empty) return null;
      return new Uint8Array([1, 2, 3, 4]);
    },
  };
  return { archiver, calls };
}

test('download returns a running workspace\'s archive', async () => {
  const fake = fakeArchiver();
  const fx = fixture({ archiver: fake.archiver });
  const w = await runningWorkspace(fx.workspaces);
  const res = await fx.svc.download('u1', w.id);
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.deepEqual([...res.archive], [1, 2, 3, 4]);
  assert.deepEqual(fake.calls, [w.id]);
});

test('download rejects a workspace that is not running', async () => {
  const fx = fixture({ archiver: fakeArchiver().archiver });
  const w = await fx.workspaces.create({
    tenantId: 't1',
    userId: 'u1',
    templateSlug: 'spring-boot',
    runtimeTier: 'tier_2_container',
    status: 'stopped',
    ideHost: null,
    storageRef: null,
  });
  const res = await fx.svc.download('u1', w.id);
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.equal(res.reason, 'workspace_not_running');
});

test('download rejects a workspace owned by another user', async () => {
  const fx = fixture({ archiver: fakeArchiver().archiver });
  const w = await runningWorkspace(fx.workspaces, 'someone-else');
  const res = await fx.svc.download('u1', w.id);
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.equal(res.reason, 'workspace_not_found');
});

test('download reports unavailable when no archiver is configured', async () => {
  const fx = fixture();
  const w = await runningWorkspace(fx.workspaces);
  const res = await fx.svc.download('u1', w.id);
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.equal(res.reason, 'download_unavailable');
});

test('download reports an empty workspace distinctly', async () => {
  const fx = fixture({ archiver: fakeArchiver({ empty: true }).archiver });
  const w = await runningWorkspace(fx.workspaces);
  const res = await fx.svc.download('u1', w.id);
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.equal(res.reason, 'download_empty');
});

test('an archiver error during download is reported, not thrown', async () => {
  const fx = fixture({ archiver: fakeArchiver({ fail: true }).archiver });
  const w = await runningWorkspace(fx.workspaces);
  const res = await fx.svc.download('u1', w.id);
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.equal(res.reason, 'download_failed');
});

// ------------------------------------------------------------ delete (E6)

test('deleting a workspace terminates its compute and removes the fork', async () => {
  const { provider } = fakeProvider();
  const terminated: string[] = [];
  provider.terminate = async (id) => {
    terminated.push(id);
  };
  const fx = fixture({ provider });
  const forked = await fx.svc.fork({
    userId: 'u1',
    tenantId: 't1',
    projectId: 'p1',
    componentId: 'c1',
  });
  assert.equal(forked.ok, true);
  if (!forked.ok) return;

  const res = await fx.svc.deleteWorkspace('u1', forked.workspaceId);
  assert.equal(res.ok, true);
  assert.deepEqual(terminated, [forked.workspaceId]);
  assert.equal(await fx.workspaces.findById(forked.workspaceId), null);
  assert.equal(await fx.forks.findById(forked.forkId), null);
  // The component is forkable again from scratch.
  const again = await fx.svc.fork({
    userId: 'u1',
    tenantId: 't1',
    projectId: 'p1',
    componentId: 'c1',
  });
  assert.equal(again.ok, true);
  if (!again.ok) return;
  assert.notEqual(again.workspaceId, forked.workspaceId);
});

test('deleting another user\'s workspace is not found and touches nothing', async () => {
  const fx = fixture();
  const w = await runningWorkspace(fx.workspaces, 'someone-else');
  const res = await fx.svc.deleteWorkspace('u1', w.id);
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.equal(res.reason, 'workspace_not_found');
  assert.ok(await fx.workspaces.findById(w.id), 'the other user\'s workspace is untouched');
});

test('deleting an unknown workspace reports not found', async () => {
  const fx = fixture();
  const res = await fx.svc.deleteWorkspace('u1', 'does-not-exist');
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.equal(res.reason, 'workspace_not_found');
});

/** A provider that records suspend/resume/terminate, for the ADR-20 tests. */
function suspendableProvider() {
  const calls: { suspend: string[]; resume: string[]; terminate: string[] } = {
    suspend: [],
    resume: [],
    terminate: [],
  };
  const provider: LabProvider & { suspend(id: string): Promise<void>; resume(id: string): Promise<void> } = {
    name: 'suspendable',
    async provision(spec) {
      return {
        session_id: spec.session_id,
        status: 'ACTIVE',
        tier: spec.runtime_tier,
        ide_host: 'ide.example.com',
        ide_url: 'https://ide.example.com/ws',
        provider_ref: `ns-${spec.session_id}`,
        started_at: new Date().toISOString(),
        last_activity_at: new Date().toISOString(),
        ttl_seconds: spec.ttl_seconds,
      };
    },
    async status(sessionId: string) {
      return {
        session_id: sessionId,
        status: 'ACTIVE',
        tier: 'tier_2_container',
        ide_host: 'ide.example.com',
        ide_url: 'https://ide.example.com/ws',
        provider_ref: `ns-${sessionId}`,
        started_at: new Date().toISOString(),
        last_activity_at: new Date().toISOString(),
        ttl_seconds: 1800,
      };
    },
    async heartbeat() {
      throw new Error('not used');
    },
    async terminate(id) {
      calls.terminate.push(id);
    },
    async suspend(id) {
      calls.suspend.push(id);
    },
    async resume(id) {
      calls.resume.push(id);
    },
  };
  return { provider, calls };
}

test('stopping a fork suspends its compute instead of destroying the volume', async () => {
  const { provider, calls } = suspendableProvider();
  const fx = fixture({ provider });
  const w = await runningWorkspace(fx.workspaces);
  const stopped = await fx.svc.stopWorkspace('u1', w.id);
  assert.equal(stopped.ok, true);
  assert.deepEqual(calls.suspend, [w.id]);
  assert.deepEqual(calls.terminate, [], 'a suspendable provider must not be torn down');
  assert.equal((await fx.workspaces.findById(w.id))?.status, 'stopped');
});

test('re-forking a stopped suspendable workspace resumes it without re-provisioning', async () => {
  const { provider, calls } = suspendableProvider();
  const fx = fixture({ provider });

  const first = await fx.svc.fork({ userId: 'u1', tenantId: 't1', projectId: 'p1', componentId: 'c1' });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  await waitFor(async () => (await fx.workspaces.findById(first.workspaceId))?.status === 'running');

  await fx.svc.stopWorkspace('u1', first.workspaceId);
  const resumed = await fx.svc.fork({ userId: 'u1', tenantId: 't1', projectId: 'p1', componentId: 'c1' });
  assert.equal(resumed.ok, true);
  if (!resumed.ok) return;
  assert.equal(resumed.forkId, first.forkId);

  await waitFor(async () => (await fx.workspaces.findById(first.workspaceId))?.status === 'running');
  assert.deepEqual(calls.resume, [first.workspaceId]);
  assert.deepEqual(calls.terminate, [], 'resume must not re-provision from scratch');
  // `stop` clears ideHost; the resume restores it so the card keeps its
  // "Open workspace" link instead of staying dead until the next re-fork.
  assert.equal(
    (await fx.workspaces.findById(first.workspaceId))?.ideHost,
    'ide.example.com',
  );
});

test('re-forking a failed workspace re-provisions instead of patching a gone Deployment', async () => {
  // A failed fork may have no namespace at all (provisioning died early, or the
  // cluster was rebuilt), so a scale-up patch would 404. The provider's applies
  // are idempotent, so re-provisioning repairs it.
  const { provider, calls } = suspendableProvider();
  const provisioned: string[] = [];
  provider.provision = async (spec) => {
    provisioned.push(spec.session_id);
    return {
      session_id: spec.session_id,
      status: 'ACTIVE',
      tier: spec.runtime_tier,
      ide_url: 'https://ide.example.com/ws',
      provider_ref: `ns-${spec.session_id}`,
      started_at: new Date().toISOString(),
      last_activity_at: new Date().toISOString(),
      ttl_seconds: spec.ttl_seconds,
    };
  };
  const fx = fixture({ provider });

  const first = await fx.svc.fork({ userId: 'u1', tenantId: 't1', projectId: 'p1', componentId: 'c1' });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  await waitFor(async () => (await fx.workspaces.findById(first.workspaceId))?.status === 'running');

  await fx.workspaces.update(first.workspaceId, { status: 'failed' });
  const again = await fx.svc.fork({ userId: 'u1', tenantId: 't1', projectId: 'p1', componentId: 'c1' });
  assert.equal(again.ok, true);
  if (!again.ok) return;

  await waitFor(async () => (await fx.workspaces.findById(first.workspaceId))?.status === 'running');
  assert.deepEqual(calls.resume, [], 'a failed workspace must not be resumed');
  assert.deepEqual(provisioned, [first.workspaceId, first.workspaceId]);
});

test('reading a running workspace whose workload is gone marks it failed', async () => {
  // A rebuilt cluster leaves the row claiming `running` with a host while the
  // workload is gone; the read path repairs it so the UI never shows a link
  // that 404s at the ingress.
  const fx = fixture({
    provider: { ...fakeProvider().provider, async status() { return null; } },
  });
  const w = await runningWorkspace(fx.workspaces);
  const fork = await seedFork(fx, w.id);
  const res = await fx.svc.getForkStatus(fork.id);
  assert.equal(res?.workspace?.status, 'failed');
  assert.equal(res?.workspace?.ideHost, null);
  assert.equal((await fx.workspaces.findById(w.id))?.status, 'failed');
});

test('reading a running workspace whose workload still exists leaves it running', async () => {
  const fx = fixture({ provider: fakeProvider().provider });
  const w = await runningWorkspace(fx.workspaces);
  const fork = await seedFork(fx, w.id);
  const res = await fx.svc.getForkStatus(fork.id);
  assert.equal(res?.workspace?.status, 'running');
  assert.equal(res?.workspace?.ideHost, 'ide.example.com');
});

test('reading a running workspace survives a provider error', async () => {
  // A transient control-plane blip must not condemn a healthy workspace.
  const fx = fixture({
    provider: {
      ...fakeProvider().provider,
      async status() {
        throw new Error('control plane unreachable');
      },
    },
  });
  const w = await runningWorkspace(fx.workspaces);
  const fork = await seedFork(fx, w.id);
  const res = await fx.svc.getForkStatus(fork.id);
  assert.equal(res?.workspace?.status, 'running');
});

test('reading a stopped workspace does not probe the execution plane', async () => {
  // A stopped workspace legitimately has no running compute; reconciling it
  // would wrongly flip a resumable workspace to failed.
  let probed = false;
  const fx = fixture({
    provider: {
      ...fakeProvider().provider,
      async status() {
        probed = true;
        return null;
      },
    },
  });
  const w = await runningWorkspace(fx.workspaces);
  await fx.svc.stopWorkspace('u1', w.id);
  const fork = await seedFork(fx, w.id);
  const res = await fx.svc.getForkStatus(fork.id);
  assert.equal(res?.workspace?.status, 'stopped');
  assert.equal(probed, false, 'a stopped workspace must not be reconciled');
});

test('re-forking a stale running workspace re-provisions instead of re-attaching', async () => {
  // The row says `running` but the workload is gone; a plain re-attach would
  // hand back a dead IDE URL, so the reconcile turns it into a re-provision.
  const provisioned: string[] = [];
  const provider = {
    ...suspendableProvider().provider,
    async status() {
      return null;
    },
    async provision(spec: LabSpec) {
      provisioned.push(spec.session_id);
      return {
        session_id: spec.session_id,
        status: 'ACTIVE' as const,
        tier: spec.runtime_tier,
        ide_host: 'ide.example.com',
        ide_url: 'https://ide.example.com/ws',
        provider_ref: `ns-${spec.session_id}`,
        started_at: new Date().toISOString(),
        last_activity_at: new Date().toISOString(),
        ttl_seconds: spec.ttl_seconds,
      };
    },
  };
  const fx = fixture({ provider });
  const w = await runningWorkspace(fx.workspaces);
  const fork = await seedFork(fx, w.id);

  const res = await fx.svc.fork({
    userId: 'u1',
    tenantId: 't1',
    projectId: 'p1',
    componentId: 'c1',
  });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.forkId, fork.id);
  await waitFor(async () => provisioned.length === 1);
  assert.deepEqual(provisioned, [w.id], 'a stale workspace must be re-provisioned');
  assert.equal((await fx.workspaces.findById(w.id))?.status, 'running');
});

test('a non-suspendable provider is terminated on stop', async () => {
  const { provider } = fakeProvider();
  const terminated: string[] = [];
  provider.terminate = async (id) => {
    terminated.push(id);
  };
  const fx = fixture({ provider });
  const w = await runningWorkspace(fx.workspaces);
  await fx.svc.stopWorkspace('u1', w.id);
  assert.deepEqual(terminated, [w.id]);
});

test('a new fork is rejected once the tenant storage ceiling is reached', async () => {
  // tier-2 forks are 2 GiB each, so a 4 GiB ceiling admits two workspaces.
  const fx = fixture({ tenant: { maxStorageGb: 4 } });
  for (const id of ['w1', 'w2']) {
    await fx.workspaces.seed({
      id,
      tenantId: 't1',
      userId: 'u1',
      templateSlug: 'spring-boot',
      runtimeTier: 'tier_2_container',
      status: 'stopped',
      ideHost: null,
      storageRef: `vol-${id}`,
      deployUrl: null,
      deployPort: null,
      qualityScore: null,
      qualityReport: null,
      analyzedAt: null,
      createdAt: new Date(),
      lastActivityAt: new Date(),
    });
  }

  const res = await fx.svc.fork({
    userId: 'u1',
    tenantId: 't1',
    projectId: 'p1',
    componentId: 'c1',
  });
  assert.equal(res.ok, false);
  if (res.ok) return;
  assert.equal(res.reason, 'storage_exceeded');
  assert.equal((await fx.workspaces.countByTenant('t1')), 2, 'no third volume is created');
});

test('an unlimited tenant is never storage-gated', async () => {
  const fx = fixture({ tenant: { maxStorageGb: 0 } });
  for (let i = 0; i < 5; i += 1) {
    await fx.workspaces.seed({
      id: `w${i}`,
      tenantId: 't1',
      userId: 'u1',
      templateSlug: 'spring-boot',
      runtimeTier: 'tier_2_container',
      status: 'stopped',
      ideHost: null,
      storageRef: `vol-${i}`,
      deployUrl: null,
      deployPort: null,
      qualityScore: null,
      qualityReport: null,
      analyzedAt: null,
      createdAt: new Date(),
      lastActivityAt: new Date(),
    });
  }
  const res = await fx.svc.fork({
    userId: 'u1',
    tenantId: 't1',
    projectId: 'p1',
    componentId: 'c1',
  });
  assert.equal(res.ok, true);
});

test('re-forking a stopped workspace is not storage-gated', async () => {
  // The tenant is already at its ceiling, but resuming an existing fork adds no
  // volume, so it must still succeed.
  const fx = fixture({ tenant: { maxStorageGb: 2 } });
  const first = await fx.svc.fork({
    userId: 'u1',
    tenantId: 't1',
    projectId: 'p1',
    componentId: 'c1',
  });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  await fx.workspaces.update(first.workspaceId, { status: 'stopped' });

  const resumed = await fx.svc.fork({
    userId: 'u1',
    tenantId: 't1',
    projectId: 'p1',
    componentId: 'c1',
  });
  assert.equal(resumed.ok, true);
  if (!resumed.ok) return;
  assert.equal(resumed.forkId, first.forkId);
});
