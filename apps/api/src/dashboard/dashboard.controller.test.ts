import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Request } from 'express';
import { SessionService } from '../identity/session.service';
import {
  InMemoryCourseRepository,
  InMemoryEnrollmentRepository,
  InMemoryGitConnectionRepository,
  InMemoryLessonRepository,
  InMemoryMembershipRepository,
  InMemoryModuleRepository,
  InMemoryProgressRepository,
  InMemoryAttemptRepository,
  InMemoryProjectRepository,
  InMemoryProjectSubmissionRepository,
  InMemoryProjectWorkspaceRepository,
  InMemorySnippetRepository,
  InMemoryUserRepository,
} from '../common/in-memory';
import { courseCatalogFrom } from '../catalog/course-catalog';
import { DashboardService } from './dashboard.service';
import { DashboardController } from '../http/controllers';

const sessions = new SessionService('test-secret');

function cookieFor(role: 'student' | 'instructor' | 'admin'): string {
  const signed = sessions.sign({
    userId: 'u1',
    tenantId: 'tenant-1',
    role,
    displayName: 'Test User',
  });
  return `${sessions.name}=${encodeURIComponent(signed)}`;
}

function req(cookie?: string): Request {
  return { headers: cookie ? { cookie } : {} } as Request;
}

function controller() {
  const service = new DashboardService({
    users: new InMemoryUserRepository([
      { id: 'u1', email: 'u1@x.dev', fullName: 'Test Student' },
    ]),
    memberships: new InMemoryMembershipRepository([
      { id: 'm1', userId: 'u1', tenantId: 'tenant-1', role: 'student', status: 'active' },
    ]),
    enrollments: new InMemoryEnrollmentRepository(),
    progress: new InMemoryProgressRepository(),
    snippets: new InMemorySnippetRepository(),
    workspaces: new InMemoryProjectWorkspaceRepository(),
    submissions: new InMemoryProjectSubmissionRepository(),
    gitConnections: new InMemoryGitConnectionRepository(),
    projects: new InMemoryProjectRepository(),
    attempts: new InMemoryAttemptRepository(),
    courses: courseCatalogFrom(
      new InMemoryCourseRepository(),
      new InMemoryModuleRepository(),
      new InMemoryLessonRepository(),
    ),
  });
  return new DashboardController(service, sessions);
}

test('the dashboard requires a session', async () => {
  await assert.rejects(() => controller().view(req()), /Sign in required/);
});

test('the dashboard is for students only', async () => {
  await assert.rejects(
    () => controller().view(req(cookieFor('instructor'))),
    /for students/,
  );
  await assert.rejects(() => controller().view(req(cookieFor('admin'))), /for students/);
});

test('a student gets their dashboard view', async () => {
  const view = await controller().view(req(cookieFor('student')));
  assert.equal(view.studentName, 'Test Student');
  assert.equal(view.roadmaps.length, 0);
  assert.equal(view.profile.percent, 0);
  // University rank is always present; batch rank only when enrolled in a batch.
  assert.equal(view.rankings.some((r) => r.scope === 'university'), true);
});
