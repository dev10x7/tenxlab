import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Request } from 'express';
import { SessionService } from '../identity/session.service';
import {
  InMemoryAttendanceRepository,
  InMemoryBatchRepository,
  InMemoryClassSessionRepository,
  InMemoryEnrollmentRepository,
  InMemoryUserRepository,
} from '../common/in-memory';
import { AttendanceService } from '../attendance/attendance.service';
import { AttendanceController } from './controllers';

const sessions = new SessionService('test-secret');

function cookieFor(role: 'student' | 'instructor' | 'admin', userId = 'u1'): string {
  const signed = sessions.sign({
    userId,
    tenantId: 'tenant-1',
    role,
    displayName: 'Test',
  });
  return `${sessions.name}=${encodeURIComponent(signed)}`;
}

function req(role?: 'student' | 'instructor' | 'admin', userId = 'u1'): Request {
  return { headers: role ? { cookie: cookieFor(role, userId) } : {} } as Request;
}

function fixture() {
  const batches = new InMemoryBatchRepository([
    { id: 'b1', tenantId: 'tenant-1', name: 'Batch One' },
  ]);
  const classSessions = new InMemoryClassSessionRepository();
  const attendance = new InMemoryAttendanceRepository();
  const enrollments = new InMemoryEnrollmentRepository();
  const users = new InMemoryUserRepository([
    { id: 'u1', email: 'u1@x.dev', fullName: 'Student One' },
    { id: 'u2', email: 'u2@x.dev', fullName: 'Student Two' },
  ]);
  const service = new AttendanceService({
    batches,
    sessions: classSessions,
    attendance,
    enrollments,
    users,
  });
  return { controller: new AttendanceController(service, sessions), enrollments };
}

test('attendance reads require a session', async () => {
  await assert.rejects(() => fixture().controller.me(req()), /Sign in required/);
});

test('a student can read their own attendance', async () => {
  const { controller } = fixture();
  const view = await controller.me(req('student'));
  assert.equal(view.sessions.length, 0);
  assert.equal(view.overall.percent, 0);
});

test('a student cannot create a class session', async () => {
  await assert.rejects(
    () =>
      fixture().controller.createSession(
        'b1',
        { title: 'Class 1', scheduledAt: '2026-02-01T09:00:00Z' },
        req('student'),
      ),
    /Instructor or admin role required/,
  );
});

test('an instructor creates a session and marks a student present', async () => {
  const { controller, enrollments } = fixture();
  await enrollments.assign({ userId: 'u1', courseId: 'c1', batchId: 'b1' });
  const session = await controller.createSession(
    'b1',
    { title: 'Class 1', scheduledAt: '2026-02-01T09:00:00Z' },
    req('instructor'),
  );
  assert.equal(session.title, 'Class 1');

  const marked = await controller.mark(
    session.id,
    { userId: 'u1', status: 'present' },
    req('instructor'),
  );
  assert.deepEqual(marked, { ok: true });

  const view = await controller.batch('b1', req('instructor'));
  assert.equal(view.rows.length, 1);
  assert.equal(view.rows[0]?.percent, 100);
});

test('an invalid status maps to a 400', async () => {
  const { controller } = fixture();
  const session = await controller.createSession(
    'b1',
    { title: 'Class 1', scheduledAt: '2026-02-01T09:00:00Z' },
    req('instructor'),
  );
  await assert.rejects(
    () => controller.mark(session.id, { userId: 'u1', status: 'nope' }, req('instructor')),
    /Unknown attendance status/,
  );
});

test('a missing batch maps to a 404', async () => {
  const { controller } = fixture();
  await assert.rejects(
    () => controller.listSessions('missing', req('student')),
    /Batch not found/,
  );
  await assert.rejects(() => controller.batch('missing', req('instructor')), /Batch not found/);
});

test('creating a session without a title maps to a 400', async () => {
  const { controller } = fixture();
  await assert.rejects(
    () => controller.createSession('b1', { title: '  ' }, req('instructor')),
    /title is required/,
  );
});
