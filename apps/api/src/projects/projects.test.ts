import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  InMemoryProjectComponentRepository,
  InMemoryProjectForkRepository,
  InMemoryProjectRepository,
  InMemoryProjectSubmissionRepository,
  InMemoryProjectWorkspaceRepository,
} from '../common/in-memory';
import { findTemplate, listTemplates, PROJECT_TEMPLATES } from './templates';
import { DEMO_PROJECT } from './demo-project';

// ---------------------------------------------------------------- templates

test('template catalog has both shapes and unique slugs', () => {
  const slugs = PROJECT_TEMPLATES.map((t) => t.slug);
  assert.equal(new Set(slugs).size, slugs.length, 'slugs must be unique');
  assert.ok(
    PROJECT_TEMPLATES.some((t) => t.kind === 'framework'),
    'expected at least one framework template',
  );
  assert.ok(
    PROJECT_TEMPLATES.some((t) => t.kind === 'base_image'),
    'expected a bare base image template',
  );
});

test('findTemplate resolves a known slug and rejects an unknown one', () => {
  assert.equal(findTemplate('react')?.title, 'React');
  assert.equal(findTemplate('does-not-exist'), null);
});

test('listTemplates returns contract objects keyed by slug', () => {
  const templates = listTemplates();
  assert.equal(templates.length, PROJECT_TEMPLATES.length);
  assert.equal(templates[0]?.id, templates[0]?.slug);
});

// ---------------------------------------------------------------- projects

test('project repository scopes listing to a tenant, newest first', async () => {
  const projects = new InMemoryProjectRepository();
  const base = {
    description: '',
    runtimeTier: 'tier_2_container',
    status: 'published',
    deadline: null,
    maxScore: 100,
  };
  const older = await projects.create({ ...base, tenantId: 't1', title: 'Older' });
  const newer = await projects.create({
    ...base,
    tenantId: 't1',
    title: 'Newer',
    status: 'draft',
  });
  await projects.create({ ...base, tenantId: 't2', title: 'Other tenant' });
  // Pin the timestamps so the ordering assertion cannot depend on two
  // `new Date()` calls landing in different milliseconds.
  await projects.update(older.id, { createdAt: new Date('2026-01-01T00:00:00Z') });
  await projects.update(newer.id, { createdAt: new Date('2026-01-02T00:00:00Z') });

  const rows = await projects.listByTenant('t1');
  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.id, newer.id, 'newest first');
  assert.equal((await projects.findById(newer.id))?.title, 'Newer');
  assert.equal(await projects.findById('missing'), null);
});

test('project update mutates the row and throws for a missing id', async () => {
  const projects = new InMemoryProjectRepository([{ ...DEMO_PROJECT }]);
  const closed = await projects.update(DEMO_PROJECT.id, { status: 'closed' });
  assert.equal(closed.status, 'closed');
  await assert.rejects(() => projects.update('nope', { status: 'closed' }));
});

// ---------------------------------------------------------------- components

test('component create stamps a row and lists by project in order', async () => {
  const components = new InMemoryProjectComponentRepository();
  const second = await components.create({
    tenantId: 't1',
    projectId: 'p1',
    title: 'Frontend',
    technology: 'react',
    templateSlug: 'react',
    templateWorkspaceId: null,
    position: 1,
  });
  const first = await components.create({
    tenantId: 't1',
    projectId: 'p1',
    title: 'Backend',
    technology: 'spring-boot',
    templateSlug: 'spring-boot',
    templateWorkspaceId: null,
    position: 0,
  });
  await components.create({
    tenantId: 't1',
    projectId: 'p2',
    title: 'Other',
    technology: 'flask',
    templateSlug: 'flask',
    templateWorkspaceId: null,
    position: 0,
  });
  assert.ok(second.createdAt instanceof Date);
  const rows = await components.listByProject('p1');
  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.id, first.id, 'ordered by position');
  assert.equal((await components.findById(first.id))?.technology, 'spring-boot');
});

test('a component can point at an existing workspace instead of a catalog template', async () => {
  const components = new InMemoryProjectComponentRepository();
  const c = await components.create({
    tenantId: 't1',
    projectId: 'p1',
    title: 'Fork my own',
    technology: 'python',
    templateSlug: null,
    templateWorkspaceId: 'ws-42',
    position: 0,
  });
  assert.equal(c.templateSlug, null);
  assert.equal(c.templateWorkspaceId, 'ws-42');
});

// ---------------------------------------------------------------- workspaces

test('workspace create defaults activity timestamps and is stoppable', async () => {
  const workspaces = new InMemoryProjectWorkspaceRepository();
  const w = await workspaces.create({
    tenantId: 't1',
    userId: 'u1',
    templateSlug: 'react',
    runtimeTier: 'tier_2_container',
    status: 'provisioning',
    ideUrl: null,
    storageRef: null,
  });
  assert.ok(w.createdAt instanceof Date);
  assert.equal(w.lastActivityAt.getTime(), w.createdAt.getTime());

  const stopped = await workspaces.update(w.id, {
    status: 'stopped',
    ideUrl: null,
  });
  assert.equal(stopped.status, 'stopped');
  assert.equal(stopped.storageRef, null, 'storage persists across a stop');
});

test('workspace listing is scoped by tenant and user', async () => {
  const workspaces = new InMemoryProjectWorkspaceRepository();
  await workspaces.create({
    tenantId: 't1',
    userId: 'u1',
    templateSlug: 'react',
    runtimeTier: 'tier_2_container',
    status: 'stopped',
    ideUrl: null,
    storageRef: null,
  });
  await workspaces.create({
    tenantId: 't1',
    userId: 'u2',
    templateSlug: 'react',
    runtimeTier: 'tier_2_container',
    status: 'stopped',
    ideUrl: null,
    storageRef: null,
  });
  assert.equal((await workspaces.listByUser('t1', 'u1')).length, 1);
  assert.equal((await workspaces.listByUser('t2', 'u1')).length, 0);
});

// ---------------------------------------------------------------- forks

test('fork records its component and source, lists by project and user', async () => {
  const forks = new InMemoryProjectForkRepository();
  const f = await forks.create({
    tenantId: 't1',
    projectId: 'p1',
    componentId: 'c1',
    userId: 'u1',
    workspaceId: 'w1',
    sourceTemplateSlug: 'react',
    sourceWorkspaceId: null,
  });
  assert.ok(f.createdAt instanceof Date);
  const byComponent = await forks.findByComponentAndUser('c1', 'u1');
  assert.equal(byComponent?.id, f.id);
  assert.equal(await forks.findByComponentAndUser('c1', 'u2'), null);
  assert.equal((await forks.listByProjectAndUser('p1', 'u1')).length, 1);
  assert.equal((await forks.listByProjectAndUser('p1', 'u2')).length, 0);
  assert.equal((await forks.listByProject('p1')).length, 1);
  assert.equal((await forks.findById(f.id))?.workspaceId, 'w1');
});

test('a project with N components yields up to N forks per student', async () => {
  const forks = new InMemoryProjectForkRepository();
  await forks.create({
    tenantId: 't1',
    projectId: 'p1',
    componentId: 'backend',
    userId: 'u1',
    workspaceId: 'w-be',
    sourceTemplateSlug: 'spring-boot',
    sourceWorkspaceId: null,
  });
  await forks.create({
    tenantId: 't1',
    projectId: 'p1',
    componentId: 'frontend',
    userId: 'u1',
    workspaceId: 'w-fe',
    sourceTemplateSlug: 'react',
    sourceWorkspaceId: null,
  });
  assert.equal((await forks.listByProjectAndUser('p1', 'u1')).length, 2);
});

// ---------------------------------------------------------------- submissions

test('submission create stamps submittedAt and leaves evaluation empty', async () => {
  const subs = new InMemoryProjectSubmissionRepository();
  const s = await subs.create({
    tenantId: 't1',
    projectId: 'p1',
    componentId: 'c1',
    userId: 'u1',
    workspaceId: 'w1',
    title: 'My API',
    description: 'A REST API',
    githubUrl: null,
    demoUrl: null,
    status: 'submitted',
    score: null,
    feedback: null,
  });
  assert.ok(s.submittedAt instanceof Date);
  assert.equal(s.evaluatedAt, null);
  assert.equal(s.status, 'submitted');
});

test('submission evaluation records score, feedback, and the time', async () => {
  const subs = new InMemoryProjectSubmissionRepository();
  const s = await subs.create({
    tenantId: 't1',
    projectId: 'p1',
    componentId: 'c1',
    userId: 'u1',
    workspaceId: 'w1',
    title: 'My API',
    description: '',
    githubUrl: null,
    demoUrl: null,
    status: 'submitted',
    score: null,
    feedback: null,
  });
  const evaluated = await subs.update(s.id, {
    status: 'evaluated',
    score: 88,
    feedback: 'Good structure',
    evaluatedAt: new Date(),
  });
  assert.equal(evaluated.status, 'evaluated');
  assert.equal(evaluated.score, 88);
  assert.ok(evaluated.evaluatedAt instanceof Date);
});

test('submission listing is tenant-scoped for both views', async () => {
  const subs = new InMemoryProjectSubmissionRepository();
  const base = {
    projectId: 'p1',
    componentId: 'c1',
    userId: 'u1',
    workspaceId: 'w1',
    title: 'S',
    description: '',
    githubUrl: null,
    demoUrl: null,
    status: 'submitted',
    score: null,
    feedback: null,
  };
  await subs.create({ ...base, tenantId: 't1' });
  await subs.create({ ...base, tenantId: 't2' });
  assert.equal((await subs.listByProject('t1', 'p1')).length, 1);
  assert.equal((await subs.listByUser('t1', 'u1')).length, 1);
  assert.equal((await subs.listByUser('t1', 'u2')).length, 0);
});
