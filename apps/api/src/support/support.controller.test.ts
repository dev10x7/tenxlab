import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Request } from 'express';
import { SessionService } from '../identity/session.service';
import { InMemorySupportIssueRepository } from '../common/in-memory';
import { SupportService } from './support.service';
import { SupportController } from '../http/controllers';

const sessions = new SessionService('test-secret');

function cookieFor(
  userId: string,
  role: 'student' | 'instructor' | 'admin' = 'student',
): string {
  const signed = sessions.sign({
    userId,
    tenantId: 'tenant-1',
    role,
    displayName: 'Test User',
  });
  return `${sessions.name}=${encodeURIComponent(signed)}`;
}

function req(cookie?: string): Request {
  return { headers: cookie ? { cookie } : {} } as Request;
}

function wiring() {
  const support = new SupportService(new InMemorySupportIssueRepository());
  return { support, controller: new SupportController(support, sessions) };
}

test('filing a report requires a session', async () => {
  const { controller } = wiring();
  await assert.rejects(
    () => controller.create({ title: 'T', description: 'D' }, req()),
    /Sign in required/,
  );
});

test('a signed-in student can file a report', async () => {
  const { controller } = wiring();
  const issue = await controller.create(
    { category: 'bug', title: 'Broken', description: 'It broke.' },
    req(cookieFor('u1')),
  );
  assert.equal(issue.title, 'Broken');
  assert.equal(issue.status, 'open');
});

test('validation failures surface as a 400 with a readable message', async () => {
  const { controller } = wiring();
  const cookie = cookieFor('u1');
  await assert.rejects(
    () => controller.create({ title: '  ', description: 'D' }, req(cookie)),
    /title is required/,
  );
  await assert.rejects(
    () => controller.create({ title: 'T', description: '' }, req(cookie)),
    /description is required/,
  );
  await assert.rejects(
    () => controller.create({ category: 'exploit', title: 'T', description: 'D' }, req(cookie)),
    /Unknown issue category/,
  );
});

test('the queue is a support-desk view, not a student one', async () => {
  const { controller } = wiring();
  await controller.create(
    { title: 'A', description: 'D' },
    req(cookieFor('u1', 'student')),
  );
  await assert.rejects(
    () => controller.list(req(cookieFor('u1', 'student'))),
    /Instructor or admin role required/,
  );

  const queue = await controller.list(req(cookieFor('i1', 'instructor')));
  assert.equal(queue.length, 1);
  assert.equal(queue[0]!.title, 'A');
});

test('a support-desk user can move an issue through the queue', async () => {
  const { controller } = wiring();
  const created = await controller.create(
    { title: 'A', description: 'D' },
    req(cookieFor('u1')),
  );
  const updated = await controller.setStatus(
    created.id,
    { status: 'in_progress' },
    req(cookieFor('i1', 'instructor')),
  );
  assert.equal(updated.status, 'in_progress');
});

test('status changes reject a missing status, a bad status, and an unknown id', async () => {
  const { controller } = wiring();
  const created = await controller.create(
    { title: 'A', description: 'D' },
    req(cookieFor('u1')),
  );
  const admin = req(cookieFor('a1', 'admin'));
  await assert.rejects(() => controller.setStatus(created.id, {}, admin), /status is required/);
  await assert.rejects(
    () => controller.setStatus(created.id, { status: 'closed' }, admin),
    /Unknown issue status/,
  );
  await assert.rejects(
    () => controller.setStatus('missing', { status: 'resolved' }, admin),
    /Issue not found/,
  );
});
