import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SessionService } from './identity/session.service';
import { CatalogService } from './catalog/catalog.service';
import { buildExerciseDescriptor, DEMO_COURSES } from './catalog/demo-data';
import { findDemoUserByEmail, DEMO_USERS } from './identity/demo-users';
import { InMemoryProgressRepository } from './common/in-memory';
import { createDemoState, resolveLessonId } from './demo/state';

// ------------------------------------------------------------- session cookie

test('session cookie round-trips the signed payload', () => {
  const svc = new SessionService('secret');
  const payload = {
    userId: 'u1',
    tenantId: 't1',
    role: 'student' as const,
    displayName: 'Demo Student',
  };
  const cookie = svc.setCookie(payload);
  const value = cookie.split(';')[0]?.split('=')[1] ?? '';
  assert.deepEqual(svc.verify(decodeURIComponent(value)), payload);
});

test('session cookie rejects tampering', () => {
  const svc = new SessionService('secret');
  const cookie = svc.sign({
    userId: 'u1',
    tenantId: 't1',
    role: 'student',
    displayName: 'X',
  });
  const [body] = cookie.split('.');
  assert.equal(svc.verify(`${body}.deadbeef`), null);
});

test('session parses the session out of a Cookie header', () => {
  const svc = new SessionService('secret');
  const value = encodeURIComponent(
    svc.sign({ userId: 'u1', tenantId: 't1', role: 'student', displayName: 'X' }),
  );
  const header = `theme=dark; tenxlab_session=${value}; other=1`;
  assert.equal(svc.fromCookieHeader(header)?.userId, 'u1');
  assert.equal(svc.fromCookieHeader('theme=dark'), null);
});

// -------------------------------------------------------------- demo identity

test('demo login rejects a wrong password', () => {
  const user = findDemoUserByEmail('student@tenxlab.local');
  assert.ok(user);
  assert.notEqual(user?.password, 'wrong');
});

test('demo users are seeded into the shared state', () => {
  const state = createDemoState();
  assert.equal(state.tenants.findById('demo-tenant') instanceof Promise, true);
  assert.equal(DEMO_USERS.length >= 1, true);
});

// -------------------------------------------------------------------- catalog

test('catalog lists courses with per-lesson progress', async () => {
  const progress = new InMemoryProgressRepository();
  const catalog = new CatalogService(progress);
  const before = await catalog.listCourses('u1');
  assert.equal(before.length, 1);
  assert.equal(before[0]?.lessons.every((l) => l.status === 'not_started'), true);

  await progress.upsert('u1', 'k8s-l2', { status: 'complete', score: 100 });
  const after = await catalog.getCourse('kubernetes-foundations', 'u1');
  const lab = after?.lessons.find((l) => l.id === 'k8s-l2');
  assert.equal(lab?.status, 'complete');
  assert.equal(lab?.score, 100);
});

test('catalog returns null for an unknown course', async () => {
  const catalog = new CatalogService(new InMemoryProgressRepository());
  assert.equal(await catalog.getCourse('nope', 'u1'), null);
});

test('demo course exposes exactly one launchable lab', () => {
  const labs = DEMO_COURSES.flatMap((c) => c.lessons).filter((l) => l.kind === 'lab');
  assert.equal(labs.length, 1);
  assert.equal(labs[0]?.exerciseSlug, 'create-simple-pod');
});

// ------------------------------------------------------- exercise descriptor

test('exercise descriptor points the agent at the asset endpoints', () => {
  const d = buildExerciseDescriptor('create-simple-pod', 'http://host:4000/');
  assert.equal(d.bootstrapUrl, 'http://host:4000/api/labs/assets/create-simple-pod/bootstrap.sh');
  assert.equal(d.checkUrl, 'http://host:4000/api/labs/assets/create-simple-pod/check.sh');
});

test('exercise descriptor rejects an unmapped slug', () => {
  assert.throws(() => buildExerciseDescriptor('nope', 'http://host:4000'));
});

test('gradebook lesson resolution maps a slug back to the demo lesson', () => {
  assert.equal(resolveLessonId('create-simple-pod', 'demo-tenant'), 'k8s-l2');
  assert.equal(resolveLessonId('create-simple-pod', 'other-tenant'), null);
});
