import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';

/**
 * Clarity exit-criterion test (ByteXL parity §2.10): CEFR-graded English
 * practice runs end to end over real HTTP, on the wired Nest application.
 *
 * Drives the flows a browser would: a student lists the task bank, practises a
 * reading task and is placed on the CEFR scale, sees their level per skill and
 * their attempt history, is refused on a bad submission, and an instructor reads
 * the cohort roster behind `clarity:read` while a student is refused it. Nothing
 * is stubbed.
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
    },
    redirect: 'manual',
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { status: res.status, body };
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

interface ClarityTaskView {
  id: string;
  skill: string;
  title: string;
  prompt: string;
  passage?: string;
  expectedTerms: string[];
}

interface ClarityAttemptView {
  id: string;
  taskId: string;
  skill: string;
  score: number;
  band: string;
  grammar: number;
  vocabulary: number;
  content: number;
  fluency: number;
}

interface ClarityLevelView {
  skill: string;
  band: string | null;
  bestScore: number | null;
  attempts: number;
  latestBand: string | null;
}

interface ClarityRosterRowView {
  userId: string;
  fullName: string;
  overallBand: string | null;
  attempts: number;
}

test('the task bank lists all four skills with their passages', async () => {
  const student = await signIn('student@tenxlab.local');
  const res = await call('/api/clarity/tasks', { cookie: student });
  assert.equal(res.status, 200);
  const tasks = res.body as ClarityTaskView[];
  const skills = new Set(tasks.map((t) => t.skill));
  assert.deepEqual([...skills].sort(), ['listening', 'reading', 'speaking', 'writing']);
  for (const t of tasks) {
    if (t.skill === 'reading' || t.skill === 'listening') {
      assert.ok(t.passage, `${t.id} carries a passage`);
    }
  }

  const filtered = await call('/api/clarity/tasks?skill=reading', { cookie: student });
  assert.equal(filtered.status, 200);
  assert.equal(
    (filtered.body as ClarityTaskView[]).every((t) => t.skill === 'reading'),
    true,
  );
});

test('a student practises a task and is placed on the CEFR scale', async () => {
  const student = await signIn('student@tenxlab.local');

  const submitted = await call('/api/clarity', {
    method: 'POST',
    cookie: student,
    body: JSON.stringify({
      taskId: 'reading-k8s-basics',
      response:
        'A Pod is the smallest deployable unit in Kubernetes. It wraps one or ' +
        'more containers that share a network namespace, and it runs on a node ' +
        'that a Deployment manages.',
    }),
  });
  assert.equal(submitted.status, 201);
  const attempt = submitted.body as ClarityAttemptView;
  assert.equal(attempt.skill, 'reading');
  assert.ok(attempt.score >= 0 && attempt.score <= 100);
  assert.match(attempt.band, /^[ABC][12]$/);
  // The response names every expected term, so the content score is full.
  assert.equal(attempt.content, 100);

  // The level table reflects the attempt; unpractised skills stay null.
  const levels = await call('/api/clarity/me/levels', { cookie: student });
  assert.equal(levels.status, 200);
  const rows = levels.body as ClarityLevelView[];
  const reading = rows.find((l) => l.skill === 'reading');
  assert.equal(reading?.attempts, 1);
  assert.equal(reading?.band, attempt.band);
  assert.equal(reading?.bestScore, attempt.score);
  assert.equal(rows.find((l) => l.skill === 'speaking')?.band, null);

  const history = await call('/api/clarity/me', { cookie: student });
  assert.equal(history.status, 200);
  assert.ok((history.body as ClarityAttemptView[]).some((a) => a.id === attempt.id));
});

test('a submission is refused when the task is unknown, the response empty, or too long', async () => {
  const student = await signIn('student@tenxlab.local');
  const unknown = await call('/api/clarity', {
    method: 'POST',
    cookie: student,
    body: JSON.stringify({ taskId: 'nope', response: 'hello' }),
  });
  assert.equal(unknown.status, 400);

  const empty = await call('/api/clarity', {
    method: 'POST',
    cookie: student,
    body: JSON.stringify({ taskId: 'reading-k8s-basics', response: '   ' }),
  });
  assert.equal(empty.status, 400);

  const tooLong = await call('/api/clarity', {
    method: 'POST',
    cookie: student,
    body: JSON.stringify({ taskId: 'reading-k8s-basics', response: 'x'.repeat(9000) }),
  });
  assert.equal(tooLong.status, 400);

  const noTask = await call('/api/clarity', {
    method: 'POST',
    cookie: student,
    body: JSON.stringify({ response: 'hello' }),
  });
  assert.equal(noTask.status, 400);
});

test('Clarity requires a session', async () => {
  const tasks = await call('/api/clarity/tasks');
  assert.equal(tasks.status, 401);
  const submit = await call('/api/clarity', {
    method: 'POST',
    body: JSON.stringify({ taskId: 'reading-k8s-basics', response: 'hi' }),
  });
  assert.equal(submit.status, 401);
});

test('the faculty roster carries every student band, and is gated by capability', async () => {
  const student = await signIn('student@tenxlab.local');
  await call('/api/clarity', {
    method: 'POST',
    cookie: student,
    body: JSON.stringify({
      taskId: 'writing-standup-update',
      response: 'I finished the login work. Next I will add tests. No blocker.',
    }),
  });

  // A student cannot read the cohort roster.
  const denied = await call('/api/clarity/roster', { cookie: student });
  assert.equal(denied.status, 403);

  // An instructor can, and the practising student appears with a band.
  const instructor = await signIn('instructor@tenxlab.local');
  const roster = await call('/api/clarity/roster', { cookie: instructor });
  assert.equal(roster.status, 200);
  const rows = roster.body as ClarityRosterRowView[];
  const row = rows.find((r) => r.userId === 'demo-student');
  assert.ok(row, 'the practising student is on the roster');
  assert.ok(row.overallBand, 'the student has an overall CEFR band');
  assert.ok(row.attempts >= 1);
});
