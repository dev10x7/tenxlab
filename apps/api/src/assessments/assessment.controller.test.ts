import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Request } from 'express';
import { SessionService } from '../identity/session.service';
import {
  InMemoryAttemptRepository,
  InMemoryMembershipRepository,
  InMemoryProctorEventRepository,
  InMemoryUserRepository,
} from '../common/in-memory';
import { AssessmentService } from '../assessments/assessment.service';
import { ProctoringService } from '../proctoring/proctoring.service';
import { IntegrityService } from '../proctoring/integrity.service';
import { AssessmentController, ProctoringController } from '../http/controllers';

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
  const attempts = new InMemoryAttemptRepository();
  const memberships = new InMemoryMembershipRepository([
    { id: 'm1', userId: 'u1', tenantId: 'tenant-1', role: 'student', status: 'active' },
    { id: 'm2', userId: 'other', tenantId: 'tenant-2', role: 'student', status: 'active' },
  ]);
  const proctorEvents = new InMemoryProctorEventRepository();
  const assessments = new AssessmentService({ attempts, memberships, runner: null });
  const proctoring = new ProctoringService(proctorEvents);
  const integrity = new IntegrityService({
    assessments,
    memberships,
    users: new InMemoryUserRepository(),
    scanner: null,
  });
  return {
    attempts,
    assessments,
    assessmentController: new AssessmentController(assessments, sessions),
    proctoringController: new ProctoringController(
      proctoring,
      integrity,
      assessments,
      sessions,
    ),
  };
}

test('assessment endpoints require a session', async () => {
  const { assessmentController } = wiring();
  await assert.rejects(() => assessmentController.list(req()), /Sign in required/);
});

test('starting and submitting an attempt runs end to end', async () => {
  const { assessmentController } = wiring();
  const cookie = cookieFor('u1');
  const attempt = await assessmentController.start('k8s-quiz-1', { passcode: 'K8S-2026' }, req(cookie));
  assert.equal(attempt.assessmentId, 'k8s-quiz-1');
  assert.equal(attempt.status, 'in_progress');

  const result = await assessmentController.submit(
    attempt.id,
    { answers: { 'q-pod': 0, 'q-kubectl': 'apply' } },
    req(cookie),
  );
  assert.ok(!('reason' in result));
  if ('reason' in result) return;
  assert.equal(result.status, 'submitted');
  assert.equal(result.score, 40);
});

test('starting an unknown assessment is a 404', async () => {
  const { assessmentController } = wiring();
  await assert.rejects(
    () => assessmentController.start('nope', { passcode: 'K8S-2026' }, req(cookieFor('u1'))),
    /not found/i,
  );
});

test('reading another user’s attempt is a 404', async () => {
  const { assessmentController } = wiring();
  const attempt = await assessmentController.start('k8s-quiz-1', { passcode: 'K8S-2026' }, req(cookieFor('u1')));
  await assert.rejects(
    () => assessmentController.attempt(attempt.id, req(cookieFor('u2'))),
    /not found/i,
  );
});

test('proctoring events require a session and a known type', async () => {
  const { assessmentController, proctoringController } = wiring();
  const attempt = await assessmentController.start('k8s-quiz-1', { passcode: 'K8S-2026' }, req(cookieFor('u1')));
  await assert.rejects(
    () => proctoringController.record(attempt.id, { type: 'copy' }, req()),
    /Sign in required/,
  );
  await assert.rejects(
    () =>
      proctoringController.record(attempt.id, { type: 'teleport' }, req(cookieFor('u1'))),
    /Unknown proctoring event type/,
  );
});

test('a student can only report events for their own attempt', async () => {
  const { assessmentController, proctoringController } = wiring();
  const attempt = await assessmentController.start('k8s-quiz-1', { passcode: 'K8S-2026' }, req(cookieFor('u1')));
  await assert.rejects(
    () =>
      proctoringController.record(attempt.id, { type: 'copy' }, req(cookieFor('u2'))),
    /not found/i,
  );
});

test('instructor review is gated and scoped to the tenant', async () => {
  const { assessmentController, proctoringController } = wiring();
  const attempt = await assessmentController.start('k8s-quiz-1', { passcode: 'K8S-2026' }, req(cookieFor('u1')));
  await proctoringController.record(
    attempt.id,
    { type: 'vm_detected' },
    req(cookieFor('u1')),
  );

  // A student may not read the integrity summary.
  await assert.rejects(
    () => proctoringController.summary(attempt.id, req(cookieFor('u1'))),
    /Instructor or admin role required/,
  );

  // The instructor of the same tenant sees the aggregate.
  const summary = await proctoringController.summary(
    attempt.id,
    req(cookieFor('instructor', 'instructor')),
  );
  assert.equal(summary.riskScore, 30);
  assert.equal(summary.riskLevel, 'high');
});

test('the instructor attempt list carries a risk summary per attempt', async () => {
  const { assessmentController, proctoringController } = wiring();
  const attempt = await assessmentController.start('k8s-quiz-1', { passcode: 'K8S-2026' }, req(cookieFor('u1')));
  await proctoringController.record(attempt.id, { type: 'copy' }, req(cookieFor('u1')));

  const list = await proctoringController.list(req(cookieFor('instructor', 'instructor')));
  assert.equal(list.length, 1);
  assert.equal(list[0]!.attemptId, attempt.id);
  assert.equal(list[0]!.risk.riskScore, 8);
});

test('starting a locked test without a passcode is a 403', async () => {
  const { assessmentController } = wiring();
  await assert.rejects(
    () => assessmentController.start('k8s-quiz-1', {}, req(cookieFor('u1'))),
    /passcode/i,
  );
});

test('starting a locked test with the wrong passcode is a 403', async () => {
  const { assessmentController } = wiring();
  await assert.rejects(
    () => assessmentController.start('k8s-quiz-1', { passcode: 'nope' }, req(cookieFor('u1'))),
    /passcode/i,
  );
});

test('the assessment view flags a locked test without leaking the code', async () => {
  const { assessmentController } = wiring();
  const view = await assessmentController.get('k8s-quiz-1', req(cookieFor('u1')));
  assert.equal(view.requiresPasscode, true);
  assert.equal((view as unknown as Record<string, unknown>)['passcode'], undefined);
});

/** A minimal express Response double that records headers and the body. */
function fakeRes() {
  const headers: Record<string, string> = {};
  let body = '';
  return {
    res: {
      setHeader: (k: string, v: string) => {
        headers[k] = v;
      },
      end: (chunk: unknown) => {
        body = String(chunk);
      },
    },
    headers,
    getBody: () => body,
  };
}

test('a proctored assessment exposes a downloadable SEB config', async () => {
  const { assessmentController } = wiring();
  const out = fakeRes();
  await assessmentController.seb('k8s-quiz-1', req(cookieFor('u1')), out.res as never);
  assert.equal(out.headers['content-type'], 'application/seb');
  assert.match(out.headers['content-disposition'] ?? '', /filename="k8s-quiz-1\.seb"/);
  const config = JSON.parse(out.getBody()) as Record<string, unknown>;
  assert.match(String(config.startURL), /\/assessments\/k8s-quiz-1$/);
  // Locked down: no app switching, no quitting, no capture.
  assert.equal(config.allowSwitchToApplications, false);
  assert.equal(config.allowQuit, false);
  assert.equal(config.enableScreenCapture, false);
});

test('a non-proctored assessment has no SEB config', async () => {
  const { assessmentController } = wiring();
  const out = fakeRes();
  await assert.rejects(
    () => assessmentController.seb('k8s-practice-1', req(cookieFor('u1')), out.res as never),
    /not proctored/i,
  );
});

test('the SEB config is not served to an anonymous caller', async () => {
  const { assessmentController } = wiring();
  const out = fakeRes();
  await assert.rejects(
    () => assessmentController.seb('k8s-quiz-1', req(), out.res as never),
    /Sign in required/,
  );
});
