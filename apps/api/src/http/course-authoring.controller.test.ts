import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Request } from 'express';
import { SessionService } from '../identity/session.service';
import {
  InMemoryCourseRepository,
  InMemoryLessonRepository,
  InMemoryModuleRepository,
} from '../common/in-memory';
import { CourseAuthoringService } from '../catalog/course-authoring.service';
import { CourseAuthoringController } from './controllers';

const sessions = new SessionService('test-secret');

function cookieFor(role: 'student' | 'instructor' | 'admin'): string {
  const signed = sessions.sign({
    userId: 'u1',
    tenantId: 'tenant-1',
    role,
    displayName: 'Test',
  });
  return `${sessions.name}=${encodeURIComponent(signed)}`;
}

function req(role?: 'student' | 'instructor' | 'admin'): Request {
  return { headers: role ? { cookie: cookieFor(role) } : {} } as Request;
}

function controller() {
  return new CourseAuthoringController(
    new CourseAuthoringService(
      new InMemoryCourseRepository(),
      new InMemoryModuleRepository(),
      new InMemoryLessonRepository(),
    ),
    sessions,
  );
}

test('authoring requires a session', async () => {
  await assert.rejects(() => controller().list(req()), /Sign in required/);
});

test('a student cannot author courses', async () => {
  await assert.rejects(
    () => controller().create({ title: 'Cloud' }, req('student')),
    /requires the "course:write" permission/,
  );
});

test('an instructor can create and read back a course', async () => {
  const c = controller();
  const created = await c.create({ title: 'Cloud' }, req('instructor'));
  assert.equal(created.slug, 'cloud');
  const listed = await c.list(req('instructor'));
  assert.equal(listed.length, 1);
});

test('a missing course id maps to a 404', async () => {
  await assert.rejects(
    () => controller().get('missing', req('instructor')),
    /Course not found/,
  );
});

test('an empty title maps to a 400', async () => {
  await assert.rejects(
    () => controller().create({ title: '' }, req('instructor')),
    /Title is required/,
  );
});
