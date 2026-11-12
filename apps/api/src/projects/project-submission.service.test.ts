import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProjectSubmissionService } from './project-submission.service';
import {
  InMemoryMembershipRepository,
  InMemoryProjectComponentRepository,
  InMemoryProjectForkRepository,
  InMemoryProjectRepository,
  InMemoryProjectSubmissionRepository,
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

async function fixture(
  overrides: { project?: Partial<ProjectRecord>; workspaceStatus?: string } = {},
) {
  const projects = new InMemoryProjectRepository([{ ...PROJECT, ...overrides.project }]);
  const components = new InMemoryProjectComponentRepository([{ ...COMPONENT }]);
  const workspaces = new InMemoryProjectWorkspaceRepository();
  const forks = new InMemoryProjectForkRepository();
  const submissions = new InMemoryProjectSubmissionRepository();
  const memberships = new InMemoryMembershipRepository([
    { id: 'm1', userId: 'u1', tenantId: 't1', role: 'student', status: 'active' },
  ]);
  const svc = new ProjectSubmissionService({
    projects,
    components,
    workspaces,
    forks,
    submissions,
    memberships,
  });

  const workspace = await workspaces.create({
    tenantId: 't1',
    userId: 'u1',
    templateSlug: 'spring-boot',
    runtimeTier: 'tier_2_container',
    status: overrides.workspaceStatus ?? 'stopped',
    ideUrl: null,
    storageRef: 'vol-1',
  });
  await forks.create({
    tenantId: 't1',
    projectId: 'p1',
    componentId: 'c1',
    userId: 'u1',
    workspaceId: workspace.id,
    sourceTemplateSlug: 'spring-boot',
    sourceWorkspaceId: null,
  });

  return { svc, projects, workspaces, submissions, workspace };
}

const base = (workspaceId: string) => ({
  userId: 'u1',
  tenantId: 't1',
  projectId: 'p1',
  componentId: 'c1',
  workspaceId,
  title: 'My API',
  description: 'A REST API',
});

test('submit records a submission for a stopped workspace', async () => {
  const { svc, submissions, workspace } = await fixture();
  const res = await svc.submit(base(workspace.id));
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.submission.status, 'submitted');
  assert.equal(res.submission.title, 'My API');
  assert.equal(res.submission.workspaceId, workspace.id);
  assert.equal((await submissions.listByUser('t1', 'u1')).length, 1);
});

test('submit rejects an active workspace (stop before submit)', async () => {
  const { svc, workspace } = await fixture({ workspaceStatus: 'running' });
  const res = await svc.submit(base(workspace.id));
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.reason, 'workspace_active');
    assert.match(res.message, /Close your workspace/);
  }
});

test('submit rejects a project past its deadline', async () => {
  const { svc, workspace } = await fixture({
    project: { deadline: new Date('2020-01-01T00:00:00Z') },
  });
  const res = await svc.submit(base(workspace.id));
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.reason, 'deadline_passed');
});

test('submit rejects a workspace that is not the student own fork', async () => {
  const { svc, workspaces } = await fixture();
  const other = await workspaces.create({
    tenantId: 't1',
    userId: 'u2',
    templateSlug: 'spring-boot',
    runtimeTier: 'tier_2_container',
    status: 'stopped',
    ideUrl: null,
    storageRef: null,
  });
  const res = await svc.submit(base(other.id));
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.reason, 'fork_required');
});

test('submit rejects an unpublished project', async () => {
  const { svc, workspace } = await fixture({ project: { status: 'draft' } });
  const res = await svc.submit(base(workspace.id));
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.reason, 'project_not_open');
});

test('resubmitting replaces the prior row instead of duplicating it', async () => {
  const { svc, submissions, workspace } = await fixture();
  await svc.submit(base(workspace.id));
  await svc.submit({ ...base(workspace.id), title: 'My API v2' });
  const rows = await submissions.listByUser('t1', 'u1');
  assert.equal(rows.length, 1, 'one submission per component and student');
  assert.equal(rows[0]?.title, 'My API v2');
});

test('evaluate records a score, feedback, and evaluated status', async () => {
  const { svc, workspace } = await fixture();
  const created = await svc.submit(base(workspace.id));
  assert.equal(created.ok, true);
  if (!created.ok) return;

  const evaluated = await svc.evaluate('t1', created.submission.id, {
    score: 88,
    feedback: 'Good structure',
  });
  assert.equal(evaluated.ok, true);
  if (!evaluated.ok) return;
  assert.equal(evaluated.submission.status, 'evaluated');
  assert.equal(evaluated.submission.score, 88);
  assert.ok(evaluated.submission.evaluatedAt instanceof Date);
});

test('evaluate rejects a score above the project maximum', async () => {
  const { svc, workspace } = await fixture();
  const created = await svc.submit(base(workspace.id));
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const out = await svc.evaluate('t1', created.submission.id, { score: 150 });
  assert.equal(out.ok, false);
  if (!out.ok) assert.equal(out.reason, 'score_out_of_range');
});

test('evaluate rejects an unknown submission or a foreign tenant', async () => {
  const { svc, workspace } = await fixture();
  const created = await svc.submit(base(workspace.id));
  assert.equal(created.ok, true);
  if (!created.ok) return;
  assert.equal((await svc.evaluate('t1', 'missing', { score: 10 })).ok, false);
  assert.equal((await svc.evaluate('t2', created.submission.id, { score: 10 })).ok, false);
});

test('listForStudent joins each submission with its workspace', async () => {
  const { svc, workspace } = await fixture();
  await svc.submit(base(workspace.id));
  const views = await svc.listForStudent('t1', 'u1');
  assert.equal(views.length, 1);
  assert.equal(views[0]?.workspace?.id, workspace.id);
});

test('listForProject is tenant-scoped for the instructor view', async () => {
  const { svc, workspace } = await fixture();
  await svc.submit(base(workspace.id));
  assert.equal((await svc.listForProject('t1', 'p1')).length, 1);
  assert.equal((await svc.listForProject('t2', 'p1')).length, 0);
});
