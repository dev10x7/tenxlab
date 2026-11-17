import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';

/**
 * Course-authoring exit criterion: a course an instructor authors at runtime
 * reaches the student dashboard roadmap and the instructor gradebook, exactly
 * like a seeded one. The authored course is absent from `DEMO_COURSES`, so the
 * test only passes if enrolment → course resolution goes through the
 * repositories rather than the static demo array.
 *
 * Boots the actual Nest application (default in-memory store) and drives the
 * flow over real HTTP. Nothing is stubbed — this is the wired app.
 */

let app: INestApplication;
let base: string;

async function call(
  path: string,
  init: RequestInit & { cookie?: string } = {},
): Promise<{ status: number; body: any }> {
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
  return res.headers.get('set-cookie')!.split(';')[0]!;
}

before(async () => {
  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('./http/app.module');
  app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0);
  base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
});

after(async () => {
  await app?.close();
});

test('an authored course reaches the dashboard roadmap and the gradebook', async () => {
  const instructor = await signIn('instructor@tenxlab.local');
  const student = await signIn('student@tenxlab.local');

  // Author a brand-new course (absent from DEMO_COURSES).
  const created = await call('/api/authoring/courses', {
    method: 'POST',
    cookie: instructor,
    body: JSON.stringify({ title: 'Smoke Test Course', description: 'authored live' }),
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const courseId = created.body.id;
  assert.equal(created.body.slug, 'smoke-test-course');

  const mod = await call(`/api/authoring/courses/${courseId}/modules`, {
    method: 'POST',
    cookie: instructor,
    body: JSON.stringify({ title: 'Chapter 1' }),
  });
  assert.equal(mod.status, 201, JSON.stringify(mod.body));

  const lesson = await call(`/api/authoring/courses/modules/${mod.body.id}/lessons`, {
    method: 'POST',
    cookie: instructor,
    body: JSON.stringify({ title: 'Reading A', type: 'reading', body: 'hi' }),
  });
  assert.equal(lesson.status, 201, JSON.stringify(lesson.body));
  const labLesson = await call(`/api/authoring/courses/modules/${mod.body.id}/lessons`, {
    method: 'POST',
    cookie: instructor,
    body: JSON.stringify({ title: 'Lab A', type: 'interactive_lab', maxScore: 100 }),
  });
  assert.equal(labLesson.status, 201, JSON.stringify(labLesson.body));

  const pub = await call(`/api/authoring/courses/${courseId}/publish`, {
    method: 'POST',
    cookie: instructor,
  });
  assert.equal(pub.status, 201, JSON.stringify(pub.body));
  assert.equal(pub.body.status, 'published');

  // Enrol the demo student on the authored course via a fresh batch.
  const batch = await call('/api/batches', {
    method: 'POST',
    cookie: instructor,
    body: JSON.stringify({ name: 'Smoke Batch' }),
  });
  assert.equal(batch.status, 201, JSON.stringify(batch.body));
  const assign = await call(`/api/batches/${batch.body.id}/students`, {
    method: 'POST',
    cookie: instructor,
    body: JSON.stringify({ userId: 'demo-student', courseId }),
  });
  assert.equal(assign.status, 201, JSON.stringify(assign.body));

  // Dashboard roadmap resolves the authored course through the repositories.
  const dash = await call('/api/dashboard', { cookie: student });
  assert.equal(dash.status, 200, JSON.stringify(dash.body));
  const roadmap = dash.body.roadmaps.find((r: any) => r.courseId === courseId);
  assert.ok(roadmap, `roadmap for authored course: ${JSON.stringify(dash.body.roadmaps)}`);
  assert.equal(roadmap.title, 'Smoke Test Course');
  assert.equal(roadmap.lessonsTotal, 2);

  // Gradebook columns come from the authored course's lessons.
  const gb = await call(`/api/batches/${batch.body.id}/gradebook`, { cookie: instructor });
  assert.equal(gb.status, 200, JSON.stringify(gb.body));
  assert.deepEqual(
    gb.body.lessons.map((l: any) => l.title),
    ['Reading A', 'Lab A'],
  );
  assert.equal(gb.body.rows.length, 1);
  assert.equal(gb.body.rows[0].total, 2);
});
