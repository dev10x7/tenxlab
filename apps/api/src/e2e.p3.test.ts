import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { INestApplication } from '@nestjs/common';
import type { AddressInfo } from 'node:net';

/**
 * P3 exit-criterion test: the eight P3 surfaces run end to end over real HTTP.
 *
 * Boots the actual Nest application (default in-memory store) and drives the
 * flows a browser would: read a Skill Passport and the recruiter shortlist, take
 * an AI mock interview and watch the communication score land on the passport,
 * chat with the AI Mentor, read the cohort Feed, post and follow on Social,
 * author in the Question Bank, read Student Reports, and read the admin
 * Organizations console. Nothing is stubbed — this is the wired app.
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

// ------------------------------------------------------------ Skill Passport

test('a student reads their own Skill Passport', async () => {
  const student = await signIn('student@tenxlab.local');
  const res = await call('/api/passport/me', { cookie: student });
  assert.equal(res.status, 200);
  const passport = res.body as {
    userId: string;
    fullName: string;
    verifiedBadges: number;
    avgLabScore: number | null;
    communicationScore: number | null;
    badges: unknown[];
    updatedAt: string;
  };
  assert.equal(passport.userId, 'demo-student');
  assert.ok(passport.fullName.length > 0);
  assert.ok(Array.isArray(passport.badges));
  assert.ok(typeof passport.updatedAt === 'string');
});

test('the recruiter shortlist is instructor-only and filterable', async () => {
  const student = await signIn('student@tenxlab.local');
  const denied = await call('/api/passport/recruiter', { cookie: student });
  assert.equal(denied.status, 403, 'a student cannot read the recruiter view');

  const instructor = await signIn('instructor@tenxlab.local');
  const all = await call('/api/passport/recruiter', { cookie: instructor });
  assert.equal(all.status, 200);
  const rows = all.body as Array<{ userId: string; readiness: number | null }>;
  assert.ok(rows.some((r) => r.userId === 'demo-student'));

  const filtered = await call('/api/passport/recruiter?query=demo', { cookie: instructor });
  assert.equal(filtered.status, 200);
  const filteredRows = filtered.body as Array<{ fullName: string }>;
  assert.ok(filteredRows.every((r) => /demo/i.test(r.fullName)));
});

// ------------------------------------------------------------ AI Interviewer

test('an AI mock interview scores an answer and updates the passport', async () => {
  const student = await signIn('student@tenxlab.local');

  const prompts = await call('/api/interviews/prompts', { cookie: student });
  assert.equal(prompts.status, 200);
  const bank = prompts.body as Array<{ id: string; title: string }>;
  assert.ok(bank.length > 0, 'the prompt bank is non-empty');

  const submitted = await call('/api/interviews', {
    method: 'POST',
    cookie: student,
    body: JSON.stringify({
      promptId: bank[0]!.id,
      transcript:
        'A Kubernetes Pod is the smallest deployable unit. It wraps one or more ' +
        'containers that share a network namespace and storage. A Deployment ' +
        'manages Pods on a node and keeps the desired replica count.',
    }),
  });
  assert.equal(submitted.status, 201);
  const attempt = submitted.body as {
    communicationScore: number;
    technicalAccuracy: number;
  };
  assert.ok(attempt.communicationScore >= 0 && attempt.communicationScore <= 100);
  assert.ok(attempt.technicalAccuracy > 0, 'expected terms raise the technical score');

  // The passport now carries the communication score from that sitting.
  const passport = await call('/api/passport/me', { cookie: student });
  const body = passport.body as { communicationScore: number | null };
  assert.equal(body.communicationScore, attempt.communicationScore);

  const history = await call('/api/interviews/me', { cookie: student });
  assert.equal(history.status, 200);
  assert.ok((history.body as unknown[]).length >= 1);
});

test('an interview rejects an unknown prompt and an empty answer', async () => {
  const student = await signIn('student@tenxlab.local');
  const unknown = await call('/api/interviews', {
    method: 'POST',
    cookie: student,
    body: JSON.stringify({ promptId: 'nope', transcript: 'hello' }),
  });
  assert.equal(unknown.status, 400);

  const empty = await call('/api/interviews', {
    method: 'POST',
    cookie: student,
    body: JSON.stringify({ promptId: 'k8s-explain-pod', transcript: '   ' }),
  });
  assert.equal(empty.status, 400);
});

// ------------------------------------------------------------ AI Mentor

test('the AI Mentor answers and persists the conversation', async () => {
  const student = await signIn('student@tenxlab.local');
  const cleared = await call('/api/mentor/messages', { method: 'DELETE', cookie: student });
  assert.equal(cleared.status, 200);

  const asked = await call('/api/mentor/messages', {
    method: 'POST',
    cookie: student,
    body: JSON.stringify({ question: 'How do I fix a CrashLoopBackOff?' }),
  });
  assert.equal(asked.status, 201);
  const reply = asked.body as {
    reply: { role: string; content: string };
    nextSteps: string[];
  };
  assert.equal(reply.reply.role, 'mentor');
  assert.ok(reply.reply.content.length > 0);
  assert.ok(reply.nextSteps.length > 0);

  const history = await call('/api/mentor/messages', { cookie: student });
  const turns = history.body as Array<{ role: string }>;
  assert.equal(turns.length, 2, 'the question and the answer are both logged');
  assert.equal(turns[0]!.role, 'user');
  assert.equal(turns[1]!.role, 'mentor');

  const blank = await call('/api/mentor/messages', {
    method: 'POST',
    cookie: student,
    body: JSON.stringify({ question: '   ' }),
  });
  assert.equal(blank.status, 400);
});

// ------------------------------------------------------------ Social + Feed

test('social posts, follows, and the feed reflect cohort activity', async () => {
  const student = await signIn('student@tenxlab.local');
  const instructor = await signIn('instructor@tenxlab.local');

  const posted = await call('/api/social/posts', {
    method: 'POST',
    cookie: student,
    body: JSON.stringify({ body: 'Finished the Kubernetes foundations lab!' }),
  });
  assert.equal(posted.status, 201);
  const post = posted.body as { id: string; authorName: string };
  assert.ok(post.id);

  const feed = await call('/api/social/feed', { cookie: instructor });
  assert.equal(feed.status, 200);
  assert.ok((feed.body as Array<{ id: string }>).some((p) => p.id === post.id));

  // Follow the student, then read the following-only feed.
  const followed = await call('/api/social/follows/demo-student', {
    method: 'POST',
    cookie: instructor,
  });
  assert.equal(followed.status, 201);

  const followingFeed = await call('/api/social/feed?following=1', { cookie: instructor });
  assert.equal(followingFeed.status, 200);
  assert.ok((followingFeed.body as Array<{ id: string }>).some((p) => p.id === post.id));

  const members = await call('/api/social/members', { cookie: instructor });
  assert.equal(members.status, 200);
  const directory = members.body as Array<{ userId: string; followedByMe: boolean }>;
  assert.ok(directory.some((m) => m.userId === 'demo-student' && m.followedByMe));

  const selfFollow = await call('/api/social/follows/demo-instructor', {
    method: 'POST',
    cookie: instructor,
  });
  assert.equal(selfFollow.status, 400, 'you cannot follow yourself');

  const deleted = await call('/api/social/posts/' + post.id, {
    method: 'DELETE',
    cookie: student,
  });
  assert.equal(deleted.status, 200);

  // The feed surface itself is available to the student.
  const studentFeed = await call('/api/feed', { cookie: student });
  assert.equal(studentFeed.status, 200);
  assert.ok(Array.isArray(studentFeed.body));
});

test('a student cannot delete another member’s post', async () => {
  const student = await signIn('student@tenxlab.local');
  const instructor = await signIn('instructor@tenxlab.local');
  const posted = await call('/api/social/posts', {
    method: 'POST',
    cookie: instructor,
    body: JSON.stringify({ body: 'Instructor announcement' }),
  });
  const post = posted.body as { id: string };
  const denied = await call('/api/social/posts/' + post.id, {
    method: 'DELETE',
    cookie: student,
  });
  assert.equal(denied.status, 403);
});

// ------------------------------------------------------------ Question Bank

test('the question bank is instructor-only and stores questions', async () => {
  const student = await signIn('student@tenxlab.local');
  const denied = await call('/api/question-bank', { cookie: student });
  assert.equal(denied.status, 403);

  const instructor = await signIn('instructor@tenxlab.local');
  const created = await call('/api/question-bank', {
    method: 'POST',
    cookie: instructor,
    body: JSON.stringify({
      kind: 'mcq',
      prompt: 'Which object manages a set of identical Pods?',
      options: ['Deployment', 'ConfigMap', 'Service'],
      correct: 0,
      maxScore: 5,
      tags: ['kubernetes'],
    }),
  });
  assert.equal(created.status, 201);
  const question = created.body as { id: string; kind: string; options: string[] };
  assert.equal(question.kind, 'mcq');
  assert.equal(question.options.length, 3);

  const list = await call('/api/question-bank?kind=mcq', { cookie: instructor });
  assert.equal(list.status, 200);
  assert.ok((list.body as Array<{ id: string }>).some((q) => q.id === question.id));

  const tagged = await call('/api/question-bank?tag=kubernetes', { cookie: instructor });
  assert.ok((tagged.body as Array<{ id: string }>).some((q) => q.id === question.id));

  const invalid = await call('/api/question-bank', {
    method: 'POST',
    cookie: instructor,
    body: JSON.stringify({ kind: 'mcq', prompt: 'Only one option?', options: ['a'] }),
  });
  assert.equal(invalid.status, 400);

  const removed = await call('/api/question-bank/' + question.id, {
    method: 'DELETE',
    cookie: instructor,
  });
  assert.equal(removed.status, 200);
});

// ------------------------------------------------------------ Student Reports

test('student reports roll a batch up for the trainer', async () => {
  const student = await signIn('student@tenxlab.local');
  const denied = await call('/api/reports/batches', { cookie: student });
  assert.equal(denied.status, 403);

  const instructor = await signIn('instructor@tenxlab.local');
  const list = await call('/api/reports/batches', { cookie: instructor });
  assert.equal(list.status, 200);
  const reports = list.body as Array<{
    batchId: string;
    studentCount: number;
    avgCompletion: number;
  }>;
  assert.ok(reports.length > 0, 'the demo batch is reported');
  const demo = reports[0]!;
  assert.ok(demo.studentCount >= 1, 'the demo student is on the roster');

  const detail = await call('/api/reports/batches/' + demo.batchId, { cookie: instructor });
  assert.equal(detail.status, 200);
  const body = detail.body as {
    report: { batchId: string };
    rows: Array<{ userId: string; completion: number }>;
  };
  assert.equal(body.report.batchId, demo.batchId);
  assert.ok(body.rows.some((r) => r.userId === 'demo-student'));

  const missing = await call('/api/reports/batches/nope', { cookie: instructor });
  assert.equal(missing.status, 404);
});

// ------------------------------------------------------------ Organizations

test('the organizations console is admin-only and manages departments', async () => {
  const instructor = await signIn('instructor@tenxlab.local');
  const denied = await call('/api/organizations', { cookie: instructor });
  assert.equal(denied.status, 403, 'only an admin reads the org console');

  const admin = await signIn('admin@tenxlab.local');
  const view = await call('/api/organizations', { cookie: admin });
  assert.equal(view.status, 200);
  const org = view.body as {
    tenant: { id: string; name: string };
    departments: unknown[];
    members: { total: number; students: number };
    batchCount: number;
  };
  assert.equal(org.tenant.id, 'demo-tenant');
  assert.ok(org.members.total >= 3);

  const created = await call('/api/organizations/departments', {
    method: 'POST',
    cookie: admin,
    body: JSON.stringify({ name: 'Computer Science' }),
  });
  assert.equal(created.status, 201);
  const department = created.body as { id: string; name: string };

  const duplicate = await call('/api/organizations/departments', {
    method: 'POST',
    cookie: admin,
    body: JSON.stringify({ name: 'computer science' }),
  });
  assert.equal(duplicate.status, 400, 'department names are unique per tenant');

  const after = await call('/api/organizations', { cookie: admin });
  assert.ok(
    (after.body as { departments: Array<{ id: string }> }).departments.some(
      (d) => d.id === department.id,
    ),
  );

  const removed = await call('/api/organizations/departments/' + department.id, {
    method: 'DELETE',
    cookie: admin,
  });
  assert.equal(removed.status, 200);
});
