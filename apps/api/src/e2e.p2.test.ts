import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';

/**
 * P2 exit-criterion test: a proctored exam runs end to end over real HTTP.
 *
 * Boots the actual Nest application (default in-memory store, code runner off)
 * and drives the flow a browser would: sign in, list assessments, start a
 * proctored sitting, report integrity signals, submit for grading, and read the
 * instructor integrity summary. Nothing is stubbed — this is the wired app.
 */

let app: INestApplication;
let base: string;

/** A fetch wrapper that carries the session cookie and returns status + body. */
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

/** Sign in and return the raw Cookie header to replay on later requests. */
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
  // Imported lazily so the decorators register before Nest inspects them.
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

test('the full proctored exam flow succeeds end to end', async () => {
  const student = await signIn('student@tenxlab.local');

  // 1. The graded assessment is listed and advertised as proctored.
  const list = await call('/api/assessments', { cookie: student });
  assert.equal(list.status, 200);
  const assessments = list.body as Array<{ id: string; proctored: boolean }>;
  const graded = assessments.find((a) => a.id === 'k8s-quiz-1');
  assert.ok(graded, 'the graded assessment is listed');
  assert.equal(graded.proctored, true);

  // 2. Starting a sitting returns a server-stamped deadline.
  const started = await call('/api/assessments/k8s-quiz-1/attempts', {
    method: 'POST',
    cookie: student,
  });
  assert.equal(started.status, 201);
  const attempt = started.body as {
    id: string;
    endsAt: string | null;
    remainingSeconds: number | null;
    assessment: { questions: Array<{ id: string; kind: string }> };
  };
  assert.ok(attempt.endsAt, 'a graded attempt has a deadline');
  assert.equal(attempt.remainingSeconds, 1800);
  // The student view must not leak the answer key.
  const coding = attempt.assessment.questions.find((q) => q.kind === 'coding') as
    | Record<string, unknown>
    | undefined;
  assert.equal(coding?.['tests'], undefined);

  // 3. Refreshing (starting again) resumes the same attempt, deadline intact.
  const resumed = await call('/api/assessments/k8s-quiz-1/attempts', {
    method: 'POST',
    cookie: student,
  });
  assert.equal((resumed.body as { id: string }).id, attempt.id);

  // 4. Integrity signals are reported and accepted.
  for (const type of ['focus_lost', 'copy', 'vm_detected']) {
    const evt = await call(`/api/proctoring/attempts/${attempt.id}/events`, {
      method: 'POST',
      cookie: student,
      body: JSON.stringify({ type }),
    });
    assert.equal(evt.status, 202);
  }

  // 5. Submitting grades the objective questions (the runner is off, so the
  //    coding question scores zero rather than failing the whole attempt).
  const submitted = await call(`/api/assessments/attempts/${attempt.id}/submit`, {
    method: 'POST',
    cookie: student,
    body: JSON.stringify({ answers: { 'q-pod': 0, 'q-kubectl': 'apply' } }),
  });
  assert.equal(submitted.status, 201);
  const result = submitted.body as { status: string; score: number; maxScore: number };
  assert.equal(result.status, 'submitted');
  assert.equal(result.maxScore, 100);
  assert.equal(result.score, 40); // MCQ 20 + fill 20; coding 0 (no runner)

  // 6. Submitting twice is rejected.
  const again = await call(`/api/assessments/attempts/${attempt.id}/submit`, {
    method: 'POST',
    cookie: student,
    body: JSON.stringify({ answers: {} }),
  });
  assert.equal(again.status, 400);

  // 7. The instructor sees the attempt with its aggregated risk.
  const instructor = await signIn('instructor@tenxlab.local');
  const review = await call(`/api/proctoring/attempts/${attempt.id}/summary`, {
    cookie: instructor,
  });
  assert.equal(review.status, 200);
  const summary = review.body as { riskScore: number; riskLevel: string; counts: object };
  assert.equal(summary.riskScore, 5 + 8 + 30); // focus_lost + copy + vm_detected
  assert.equal(summary.riskLevel, 'high');
});

test('a student cannot read the proctoring summary', async () => {
  const student = await signIn('student@tenxlab.local');
  const started = await call('/api/assessments/k8s-practice-1/attempts', {
    method: 'POST',
    cookie: student,
  });
  const attemptId = (started.body as { id: string }).id;
  const res = await call(`/api/proctoring/attempts/${attemptId}/summary`, {
    cookie: student,
  });
  assert.equal(res.status, 403);
});

test('unauthenticated access to assessments is rejected', async () => {
  const res = await call('/api/assessments');
  assert.equal(res.status, 401);
});
