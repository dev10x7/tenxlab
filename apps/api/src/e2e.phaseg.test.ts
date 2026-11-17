import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';
import { hmacSha256Hex } from '@tenxlab/contracts';

/**
 * Phase G exit-criterion test: contests, the live leaderboard, and the recruiter
 * surface run end to end over real HTTP, on the wired Nest application.
 *
 * Drives the flows a browser would: an instructor authors and publishes a
 * contest, a student enters a score and appears on the leaderboard, the caller's
 * own row is flagged, a lab-completion webhook credits the same contest through
 * the gradebook hook, the passport carries the best contest rank, and the
 * recruiter shortlist renders and exports as CSV. Nothing is stubbed.
 */

let app: INestApplication;
let base: string;

async function call(
  path: string,
  init: RequestInit & { cookie?: string } = {},
): Promise<{ status: number; body: unknown; text: string; headers: Headers }> {
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
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { status: res.status, body, text, headers: res.headers };
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

interface ContestView {
  id: string;
  title: string;
  status: string;
  phase: string;
  maxScore: number;
  entrants: number;
}

test('a student sees the seeded live contest; only staff can author', async () => {
  const student = await signIn('student@tenxlab.local');
  const list = await call('/api/contests', { cookie: student });
  assert.equal(list.status, 200);
  const contests = list.body as ContestView[];
  const demo = contests.find((c) => c.id === 'demo-contest-k8s-sprint');
  assert.ok(demo, 'the seeded contest is visible');
  assert.equal(demo.phase, 'live');

  const denied = await call('/api/contests', {
    method: 'POST',
    cookie: student,
    body: JSON.stringify({ title: 'Nope' }),
  });
  assert.equal(denied.status, 403, 'a student cannot author a contest');
});

test('an instructor authors and publishes a contest; a student enters it', async () => {
  const instructor = await signIn('instructor@tenxlab.local');
  const created = await call('/api/contests', {
    method: 'POST',
    cookie: instructor,
    body: JSON.stringify({
      title: 'Live Ops Sprint',
      description: 'A timed sprint',
      exerciseSlug: 'create-simple-pod',
      maxScore: 50,
    }),
  });
  assert.equal(created.status, 201);
  const contest = created.body as ContestView;
  assert.equal(contest.status, 'draft');
  assert.equal(contest.phase, 'draft');

  // A student cannot see a draft.
  const student = await signIn('student@tenxlab.local');
  const studentList = (await call('/api/contests', { cookie: student })).body as ContestView[];
  assert.ok(!studentList.some((c) => c.id === contest.id), 'drafts are hidden from students');

  const published = await call(`/api/contests/${contest.id}/publish`, {
    method: 'POST',
    cookie: instructor,
  });
  assert.equal(published.status, 201);
  assert.equal((published.body as ContestView).phase, 'live');

  const entered = await call(`/api/contests/${contest.id}/entries`, {
    method: 'POST',
    cookie: student,
    body: JSON.stringify({ score: 42, durationMs: 30_000 }),
  });
  assert.equal(entered.status, 201);
  const row = entered.body as { rank: number; score: number; isSelf: boolean };
  assert.equal(row.rank, 1);
  assert.equal(row.score, 42);
  assert.equal(row.isSelf, true);

  const board = (await call(`/api/contests/${contest.id}/leaderboard`, { cookie: student }))
    .body as Array<{ userId: string; score: number; isSelf: boolean }>;
  assert.equal(board.length, 1);
  assert.equal(board[0]!.isSelf, true);
  assert.equal(board[0]!.score, 42);

  const me = (await call(`/api/contests/${contest.id}/me`, { cookie: student })).body as {
    rank: number;
    score: number;
  };
  assert.equal(me.score, 42);
});

test('a score above the max is refused; a worse resubmission keeps the best', async () => {
  const instructor = await signIn('instructor@tenxlab.local');
  const created = (
    await call('/api/contests', {
      method: 'POST',
      cookie: instructor,
      body: JSON.stringify({ title: 'Capped', maxScore: 30 }),
    })
  ).body as ContestView;
  await call(`/api/contests/${created.id}/publish`, { method: 'POST', cookie: instructor });

  const student = await signIn('student@tenxlab.local');
  const over = await call(`/api/contests/${created.id}/entries`, {
    method: 'POST',
    cookie: student,
    body: JSON.stringify({ score: 99 }),
  });
  assert.equal(over.status, 400, 'a score above the contest max is rejected');

  await call(`/api/contests/${created.id}/entries`, {
    method: 'POST',
    cookie: student,
    body: JSON.stringify({ score: 30, durationMs: 5000 }),
  });
  await call(`/api/contests/${created.id}/entries`, {
    method: 'POST',
    cookie: student,
    body: JSON.stringify({ score: 10, durationMs: 1 }),
  });
  const me = (await call(`/api/contests/${created.id}/me`, { cookie: student })).body as {
    score: number;
    durationMs: number;
  };
  assert.equal(me.score, 30, 'the best score is kept');
  assert.equal(me.durationMs, 5000);
});

test('the passport carries the best contest rank', async () => {
  const student = await signIn('student@tenxlab.local');
  const passport = (await call('/api/passport/me', { cookie: student })).body as {
    bestContestRank: number | null;
  };
  assert.equal(passport.bestContestRank, 1);
});

test('a lab-completion webhook credits the live contest it is scoped to', async () => {
  // The seeded contest is scoped to `create-simple-pod` and is always live.
  const body = JSON.stringify({
    event: 'exercise.completed',
    event_id: 'evt_phase_g',
    student_id: 'demo-student',
    tenant_id: 'demo-tenant',
    exercise_id: 'create-simple-pod',
    session_id: 'sess_phase_g',
    status: 'PASSED',
    score: 77,
    execution_time_ms: 1420,
    attempt_count: 1,
    timestamp: '2026-11-11T09:00:00Z',
  });
  const secret = process.env.WEBHOOK_SECRET ?? 'dev-webhook-secret';
  const sig = hmacSha256Hex(secret, body);
  const res = await fetch(`${base}/api/webhooks/lab`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-tenxlab-signature-256': sig },
    body,
  });
  assert.ok(res.status < 400, `webhook accepted (${res.status})`);

  const student = await signIn('student@tenxlab.local');
  const board = (
    await call('/api/contests/demo-contest-k8s-sprint/leaderboard', { cookie: student })
  ).body as Array<{ userId: string; score: number }>;
  const row = board.find((r) => r.userId === 'demo-student');
  assert.ok(row, 'the student is on the seeded contest board');
  assert.ok(row!.score >= 77, 'the completion score is credited');
});

test('the recruiter shortlist renders, filters, and exports as CSV', async () => {
  const student = await signIn('student@tenxlab.local');
  const denied = await call('/api/passport/recruiter', { cookie: student });
  assert.equal(denied.status, 403);

  const instructor = await signIn('instructor@tenxlab.local');
  const rows = (await call('/api/passport/recruiter', { cookie: instructor })).body as Array<{
    userId: string;
    institution: string;
    bestContestRank: number | null;
    readiness: number | null;
  }>;
  const ada = rows.find((r) => r.userId === 'demo-student');
  assert.ok(ada, 'the demo student is on the shortlist');
  assert.equal(ada!.bestContestRank, 1);
  assert.ok(ada!.institution.length > 0);

  // A filter that matches nobody returns an empty list.
  const none = (await call('/api/passport/recruiter?institution=nowhere', { cookie: instructor }))
    .body as unknown[];
  assert.equal(none.length, 0);

  const csv = await call('/api/passport/recruiter.csv', { cookie: instructor });
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type') ?? '', /text\/csv/);
  const [header, first] = csv.text.trim().split('\r\n');
  assert.equal(
    header,
    'userId,fullName,email,institution,graduationYear,verifiedBadges,avgLabScore,communicationScore,bestContestRank,readiness',
  );
  assert.ok(first!.startsWith('demo-student,'), 'the CSV carries the student row');
});

test('the code-similarity scan is instructor-gated and honest about availability', async () => {
  // A student must never reach the integrity scan.
  const student = await signIn('student@tenxlab.local');
  const denied = await call('/api/proctoring/assessments/k8s-quiz-1/similarity', {
    cookie: student,
  });
  assert.equal(denied.status, 403);

  // No session at all is a 401, not a leak of cohort data.
  const anon = await call('/api/proctoring/assessments/k8s-quiz-1/similarity');
  assert.equal(anon.status, 401);

  // An instructor reaches it: 200 with a scan when the AI plane is configured,
  // or 503 when it is not — never a 5xx crash either way.
  const instructor = await signIn('instructor@tenxlab.local');
  const scan = await call('/api/proctoring/assessments/k8s-quiz-1/similarity', {
    cookie: instructor,
  });
  assert.ok(
    scan.status === 200 || scan.status === 503,
    `instructor scan answers 200 or 503 (got ${scan.status})`,
  );
  if (scan.status === 200) {
    const body = scan.body as {
      assessmentId: string;
      compared: number;
      threshold: number;
      flaggedCount: number;
      results: unknown[];
    };
    assert.equal(body.assessmentId, 'k8s-quiz-1');
    assert.equal(typeof body.compared, 'number');
    assert.ok(Array.isArray(body.results));
  }
});
