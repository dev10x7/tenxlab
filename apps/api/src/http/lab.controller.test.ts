import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Request } from 'express';
import { SessionService } from '../identity/session.service';
import { LabController } from './controllers';
import type { LabLaunchService, LaunchResult } from '../labs/lab-launch.service';
import type { UsageService } from '../labs/usage.service';

const sessions = new SessionService('test-secret');
const cookie = `${sessions.name}=${encodeURIComponent(
  sessions.sign({ userId: 'u1', tenantId: 't1', role: 'student', displayName: 'Test' }),
)}`;
const req = { headers: { cookie } } as Request;

/** A controller whose launch always fails with the given reason. */
function failingController(result: LaunchResult): LabController {
  const launch = { launch: async () => result } as unknown as LabLaunchService;
  return new LabController(launch, sessions, {} as UsageService);
}

async function statusOf(fn: () => Promise<unknown>): Promise<number> {
  try {
    await fn();
  } catch (err) {
    const e = err as { getStatus?: () => number; status?: number };
    return e.getStatus?.() ?? e.status ?? 0;
  }
  throw new Error('expected the call to reject');
}

test('a lesson without a launchable exercise maps to 400, not 401', async () => {
  const c = failingController({
    ok: false,
    reason: 'not_a_lab',
    message: 'Lesson is not an interactive lab',
  });
  assert.equal(await statusOf(() => c.launchLab({ lessonId: 'l1' }, req)), 400);
});

test('an unknown lesson maps to 404', async () => {
  const c = failingController({
    ok: false,
    reason: 'lesson_not_found',
    message: 'Lesson not found',
  });
  assert.equal(await statusOf(() => c.launchLab({ lessonId: 'l1' }, req)), 404);
});

test('a missing membership maps to 403', async () => {
  const c = failingController({
    ok: false,
    reason: 'membership_required',
    message: 'User is not an active member of this tenant',
  });
  assert.equal(await statusOf(() => c.launchLab({ lessonId: 'l1' }, req)), 403);
});

test('no execution plane maps to 503', async () => {
  const c = failingController({
    ok: false,
    reason: 'lab_unavailable',
    message: 'Lab environments are not available in this deployment',
  });
  assert.equal(await statusOf(() => c.launchLab({ lessonId: 'l1' }, req)), 503);
});

test('a full tenant maps to 429', async () => {
  const c = failingController({
    ok: false,
    reason: 'tenant_quota_exceeded',
    message: 'Tenant concurrent-lab limit reached',
  });
  assert.equal(await statusOf(() => c.launchLab({ lessonId: 'l1' }, req)), 429);
});

test('lab launch requires a signed-in session', async () => {
  const c = failingController({ ok: false, reason: 'not_a_lab', message: 'x' });
  assert.equal(await statusOf(() => c.launchLab({ lessonId: 'l1' }, { headers: {} } as Request)), 401);
});
