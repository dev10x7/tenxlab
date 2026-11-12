import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { LabSpec, SessionHandle } from '@tenxlab/contracts';
import type { LabProvider } from '@tenxlab/lab-provider';
import { ProjectService } from './project.service';
import {
  InMemoryMembershipRepository,
  InMemoryProjectComponentRepository,
  InMemoryProjectForkRepository,
  InMemoryProjectRepository,
  InMemoryProjectWorkspaceRepository,
} from '../common/in-memory';
import type { ProjectComponentRecord, ProjectRecord } from '../common/ports';

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

function fixture(overrides: { project?: Partial<ProjectRecord>; provider?: LabProvider | null } = {}) {
  const projects = new InMemoryProjectRepository([{ ...PROJECT, ...overrides.project }]);
  const components = new InMemoryProjectComponentRepository([{ ...COMPONENT }]);
  const workspaces = new InMemoryProjectWorkspaceRepository();
  const forks = new InMemoryProjectForkRepository();
  const memberships = new InMemoryMembershipRepository([
    { id: 'm1', userId: 'u1', tenantId: 't1', role: 'student', status: 'active' },
  ]);
  const svc = new ProjectService({
    projects,
    components,
    workspaces,
    forks,
    memberships,
    provider: overrides.provider ?? null,
    defaultTier: 'tier_2_container',
  });
  return { svc, projects, components, workspaces, forks, memberships };
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
        ide_url: 'https://ide.example.com/ws',
        provider_ref: `ns-${spec.session_id}`,
        started_at: new Date().toISOString(),
        last_activity_at: new Date().toISOString(),
        ttl_seconds: spec.ttl_seconds,
        ...handle,
      };
    },
    async status() {
      return null;
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
  assert.equal(workspace?.ideUrl, 'https://ide.example.com/ws');
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
    ideUrl: null,
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
