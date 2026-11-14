import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';

/**
 * Phase E exit-criterion test: the project fork → build → submit → evaluate
 * loop runs end to end over real HTTP.
 *
 * Boots the actual Nest application (default in-memory store, projects
 * provisioning disabled so no cluster is touched) and drives the flow a browser
 * would: sign in as a student, list published projects, fork a component, stop
 * the workspace, submit it, then sign in as an instructor and score it. Nothing
 * is stubbed — this is the wired app.
 */

let app: INestApplication;
let base: string;

async function call(
  path: string,
  init: RequestInit & { cookie?: string } = {},
): Promise<{ status: number; body: unknown }> {
  const { cookie, ...rest } = init;
  const res = await fetch(`${base}${path}`, {
    ...rest,
    headers: {
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
      ...(rest.headers ?? {}),
    },
    redirect: 'manual',
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

async function signIn(email: string): Promise<string> {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'demo1234' }),
  });
  assert.equal(res.ok, true, `login for ${email}`);
  const setCookie = res.headers.get('set-cookie');
  assert.ok(setCookie, 'login sets a session cookie');
  return setCookie.split(';')[0]!;
}

before(async () => {
  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('./http/app.module');
  app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0);
  const address = app.getHttpServer().address() as AddressInfo;
  base = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await app?.close();
});

test('the full project fork → submit → evaluate flow succeeds end to end', async () => {
  const student = await signIn('student@tenxlab.local');
  const instructor = await signIn('instructor@tenxlab.local');

  // 1. The published demo project is listed for the student with its component.
  const list = await call('/api/projects', { cookie: student });
  assert.equal(list.status, 200);
  const projects = list.body as Array<{
    project: { id: string; status: string };
    components: Array<{ id: string; fork: unknown }>;
  }>;
  const demo = projects.find((p) => p.project.id === 'project-demo-spring-api');
  assert.ok(demo, 'the demo project is listed');
  assert.equal(demo.project.status, 'published');
  const component = demo.components[0];
  assert.ok(component, 'the project has a component');
  assert.equal(component.fork, null, 'the student has not forked yet');

  // 2. Forking the component creates a workspace for the student.
  const forked = await call(
    `/api/projects/project-demo-spring-api/components/${component.id}/fork`,
    { method: 'POST', cookie: student },
  );
  assert.equal(forked.status, 201);
  const fork = forked.body as { forkId: string; workspaceId: string; status: string };
  assert.equal(fork.status, 'provisioning');

  // 3. The fork status is pollable by its owner.
  const status = await call(`/api/projects/forks/${fork.forkId}`, { cookie: student });
  assert.equal(status.status, 200);
  assert.equal((status.body as { workspaceId: string }).workspaceId, fork.workspaceId);

  // 4. Submitting while the workspace is not stopped is rejected.
  const early = await call(
    `/api/projects/project-demo-spring-api/components/${component.id}/submissions`,
    {
      method: 'POST',
      cookie: student,
      body: JSON.stringify({
        workspaceId: fork.workspaceId,
        title: 'My API',
        description: 'A REST API',
      }),
    },
  );
  assert.equal(early.status, 409, 'an active workspace cannot be submitted');

  // 5. Stopping the workspace, then submitting, succeeds.
  const stopped = await call(`/api/projects/workspaces/${fork.workspaceId}/stop`, {
    method: 'POST',
    cookie: student,
  });
  assert.equal(stopped.status, 201);
  assert.equal((stopped.body as { status: string }).status, 'stopped');

  const submitted = await call(
    `/api/projects/project-demo-spring-api/components/${component.id}/submissions`,
    {
      method: 'POST',
      cookie: student,
      body: JSON.stringify({
        workspaceId: fork.workspaceId,
        title: 'My API',
        description: 'A REST API',
        githubUrl: 'https://github.com/student/my-api',
      }),
    },
  );
  assert.equal(submitted.status, 201);
  const submission = submitted.body as { id: string; status: string; title: string };
  assert.equal(submission.status, 'submitted');
  assert.equal(submission.title, 'My API');

  // 6. The student sees their own submission.
  const mine = await call('/api/projects/submissions', { cookie: student });
  assert.equal(mine.status, 200);
  assert.equal((mine.body as unknown[]).length, 1);

  // 7. The instructor sees the submission in the evaluation queue and scores it.
  const queue = await call(
    '/api/projects/project-demo-spring-api/submissions',
    { cookie: instructor },
  );
  assert.equal(queue.status, 200);
  assert.equal((queue.body as unknown[]).length, 1);

  const evaluated = await call(`/api/projects/submissions/${submission.id}`, {
    method: 'PATCH',
    cookie: instructor,
    body: JSON.stringify({ score: 92, feedback: 'Clean API surface' }),
  });
  assert.equal(evaluated.status, 200);
  const scored = evaluated.body as { status: string; score: number; feedback: string };
  assert.equal(scored.status, 'evaluated');
  assert.equal(scored.score, 92);
  assert.equal(scored.feedback, 'Clean API surface');
});

test('a student cannot author or evaluate projects', async () => {
  const student = await signIn('student@tenxlab.local');
  const create = await call('/api/projects', {
    method: 'POST',
    cookie: student,
    body: JSON.stringify({ title: 'Sneaky' }),
  });
  assert.equal(create.status, 403);

  const templates = await call('/api/projects/templates', { cookie: student });
  assert.equal(templates.status, 403);
});

test('an instructor can author, add a component, and publish a project', async () => {
  const instructor = await signIn('instructor@tenxlab.local');

  const created = await call('/api/projects', {
    method: 'POST',
    cookie: instructor,
    body: JSON.stringify({ title: 'Full-stack app', description: 'Build it' }),
  });
  assert.equal(created.status, 201);
  const project = created.body as { id: string; status: string };
  assert.equal(project.status, 'draft');

  const component = await call(`/api/projects/${project.id}/components`, {
    method: 'POST',
    cookie: instructor,
    body: JSON.stringify({ title: 'Frontend', technology: 'react', templateSlug: 'react' }),
  });
  assert.equal(component.status, 201);

  const badComponent = await call(`/api/projects/${project.id}/components`, {
    method: 'POST',
    cookie: instructor,
    body: JSON.stringify({ title: 'Broken', templateSlug: 'does-not-exist' }),
  });
  assert.equal(badComponent.status, 400, 'an unknown template is rejected');

  const published = await call(`/api/projects/${project.id}/publish`, {
    method: 'POST',
    cookie: instructor,
  });
  assert.equal(published.status, 201);
  assert.equal((published.body as { status: string }).status, 'published');
});

test('deploy validates the port and refuses a workspace that is not running', async () => {
  const student = await signIn('student@tenxlab.local');

  // Fork a component so we have a workspace to deploy against.
  const list = await call('/api/projects', { cookie: student });
  const demo = (list.body as Array<{
    project: { id: string };
    components: Array<{ id: string; fork: unknown }>;
  }>).find((p) => p.project.id === 'project-demo-spring-api');
  assert.ok(demo, 'the demo project is listed');
  const component = demo.components[0]!;
  const forked = await call(
    `/api/projects/project-demo-spring-api/components/${component.id}/fork`,
    { method: 'POST', cookie: student },
  );
  assert.equal(forked.status, 201);
  const workspaceId = (forked.body as { workspaceId: string }).workspaceId;

  // A non-numeric or out-of-range port is a client error.
  const badPort = await call(`/api/projects/workspaces/${workspaceId}/deploy`, {
    method: 'POST',
    cookie: student,
    body: JSON.stringify({ port: 0 }),
  });
  assert.equal(badPort.status, 400);

  // The workspace is not running (provisioning is disabled in tests), so the
  // deploy is a conflict rather than a silent success.
  const notRunning = await call(`/api/projects/workspaces/${workspaceId}/deploy`, {
    method: 'POST',
    cookie: student,
    body: JSON.stringify({ port: 5000 }),
  });
  assert.equal(notRunning.status, 409);

  // An unknown workspace is not found.
  const missing = await call('/api/projects/workspaces/does-not-exist/deploy', {
    method: 'POST',
    cookie: student,
    body: JSON.stringify({ port: 5000 }),
  });
  assert.equal(missing.status, 404);

  // Undeploy is idempotent and clears the (absent) record.
  const undeployed = await call(`/api/projects/workspaces/${workspaceId}/deploy`, {
    method: 'DELETE',
    cookie: student,
  });
  assert.equal(undeployed.status, 200);
  assert.equal((undeployed.body as { deployUrl: string | null }).deployUrl, null);
});

test('auto-evaluation is ownership-gated and requires a running workspace', async () => {
  const student = await signIn('student@tenxlab.local');

  const list = await call('/api/projects', { cookie: student });
  const demo = (list.body as Array<{
    project: { id: string };
    components: Array<{ id: string; fork: unknown }>;
  }>).find((p) => p.project.id === 'project-demo-spring-api');
  assert.ok(demo, 'the demo project is listed');
  const component = demo.components[0]!;
  const forked = await call(
    `/api/projects/project-demo-spring-api/components/${component.id}/fork`,
    { method: 'POST', cookie: student },
  );
  assert.equal(forked.status, 201);
  const workspaceId = (forked.body as { workspaceId: string }).workspaceId;

  // Provisioning is disabled in tests, so the fork never reaches `running` and
  // analysis is a conflict rather than a silent no-op.
  const notRunning = await call(`/api/projects/workspaces/${workspaceId}/analyze`, {
    method: 'POST',
    cookie: student,
  });
  assert.equal(notRunning.status, 409);

  // An unknown workspace is not found.
  const missing = await call('/api/projects/workspaces/does-not-exist/analyze', {
    method: 'POST',
    cookie: student,
  });
  assert.equal(missing.status, 404);

  // The caller's own history is readable (empty before any run).
  const ownHistory = await call(
    `/api/projects/workspaces/${workspaceId}/evaluations`,
    { cookie: student },
  );
  assert.equal(ownHistory.status, 200);
  assert.deepEqual(ownHistory.body, []);

  // Another user cannot read that workspace's history.
  const instructor = await signIn('instructor@tenxlab.local');
  const foreign = await call(
    `/api/projects/workspaces/${workspaceId}/evaluations`,
    { cookie: instructor },
  );
  assert.equal(foreign.status, 404);
});
