import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DashboardService,
  averageScore,
  percentileFor,
} from './dashboard.service';
import { courseCatalogFrom } from '../catalog/course-catalog';
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

const COURSES = new InMemoryCourseRepository([
  {
    id: 'c1',
    tenantId: 't1',
    slug: 'k8s',
    title: 'Kubernetes Foundations',
    description: '',
    status: 'published',
    createdAt: new Date('2026-01-01'),
  },
  {
    id: 'c2',
    tenantId: 't1',
    slug: 'go',
    title: 'Go for DevOps',
    description: '',
    status: 'published',
    createdAt: new Date('2026-01-02'),
  },
]);
const MODULES = new InMemoryModuleRepository([
  { id: 'm1', courseId: 'c1', title: 'Core', position: 0 },
  { id: 'm2', courseId: 'c2', title: 'Basics', position: 0 },
]);
const LESSONS = new InMemoryLessonRepository([
  { id: 'l1', moduleId: 'm1', title: 'Pods', type: 'reading', maxScore: 0, position: 0 },
  { id: 'l2', moduleId: 'm1', title: 'Labs', type: 'interactive_lab', maxScore: 100, position: 1 },
  { id: 'l3', moduleId: 'm2', title: 'Go intro', type: 'reading', maxScore: 0, position: 0 },
]);

function build() {
  const users = new InMemoryUserRepository([
    { id: 's1', email: 's1@x.dev', fullName: 'Student One' },
    { id: 's2', email: 's2@x.dev', fullName: 'Student Two' },
    { id: 's3', email: 's3@x.dev', fullName: 'Student Three' },
  ]);
  const memberships = new InMemoryMembershipRepository([
    { id: 'm1', userId: 's1', tenantId: 't1', role: 'student', status: 'active' },
    { id: 'm2', userId: 's2', tenantId: 't1', role: 'student', status: 'active' },
    { id: 'm3', userId: 's3', tenantId: 't1', role: 'student', status: 'active' },
  ]);
  const enrollments = new InMemoryEnrollmentRepository();
  const progress = new InMemoryProgressRepository();
  const snippets = new InMemorySnippetRepository();
  const workspaces = new InMemoryProjectWorkspaceRepository();
  const submissions = new InMemoryProjectSubmissionRepository();
  const gitConnections = new InMemoryGitConnectionRepository();
  const projects = new InMemoryProjectRepository();
  const attempts = new InMemoryAttemptRepository();
  const service = new DashboardService({
    users,
    memberships,
    enrollments,
    progress,
    snippets,
    workspaces,
    submissions,
    gitConnections,
    projects,
    attempts,
    courses: courseCatalogFrom(COURSES, MODULES, LESSONS),
    assessments: [
      { id: 'a1', title: 'Kubernetes Foundations — Graded Test', courseSlug: 'k8s', mode: 'graded' },
    ],
  });
  return {
    service,
    enrollments,
    progress,
    snippets,
    gitConnections,
    projects,
    submissions,
    attempts,
  };
}

test('roadmaps resolve enrolments to course titles with progress', async () => {
  const { service, enrollments, progress } = build();
  await enrollments.assign({ userId: 's1', courseId: 'c1', batchId: 'b1' });
  await progress.upsert('s1', 'l1', { status: 'complete', score: 80 });

  const view = await service.forStudent('s1', 't1');
  assert.equal(view.roadmaps.length, 1);
  const [roadmap] = view.roadmaps;
  assert.equal(roadmap?.title, 'Kubernetes Foundations');
  assert.equal(roadmap?.slug, 'k8s');
  assert.equal(roadmap?.lessonsComplete, 1);
  assert.equal(roadmap?.lessonsTotal, 2);
  assert.equal(roadmap?.progress, 50);
});

test('an enrolment in a course the dashboard does not know is skipped', async () => {
  const { service, enrollments } = build();
  await enrollments.assign({ userId: 's1', courseId: 'unknown', batchId: 'b1' });
  const view = await service.forStudent('s1', 't1');
  assert.equal(view.roadmaps.length, 0);
});

test('a course authored after the dashboard is built resolves on the roadmap', async () => {
  const courses = new InMemoryCourseRepository();
  const modules = new InMemoryModuleRepository();
  const lessons = new InMemoryLessonRepository();
  const enrollments = new InMemoryEnrollmentRepository();
  const progress = new InMemoryProgressRepository();
  const service = new DashboardService({
    users: new InMemoryUserRepository([{ id: 's1', email: 's1@x.dev', fullName: 'S' }]),
    memberships: new InMemoryMembershipRepository([
      { id: 'm1', userId: 's1', tenantId: 't1', role: 'student', status: 'active' },
    ]),
    enrollments,
    progress,
    snippets: new InMemorySnippetRepository(),
    workspaces: new InMemoryProjectWorkspaceRepository(),
    submissions: new InMemoryProjectSubmissionRepository(),
    gitConnections: new InMemoryGitConnectionRepository(),
    projects: new InMemoryProjectRepository(),
    attempts: new InMemoryAttemptRepository(),
    courses: courseCatalogFrom(courses, modules, lessons),
  });

  // Author a brand-new course through the repositories, after the service exists.
  const course = await courses.create({
    tenantId: 't1',
    slug: 'docker-deep-dive',
    title: 'Docker Deep Dive',
    description: '',
    status: 'published',
  });
  const module = await modules.create({ courseId: course.id, title: 'Containers', position: 0 });
  const created = await lessons.create({
    moduleId: module.id,
    title: 'Images',
    type: 'reading',
    maxScore: 0,
    position: 0,
  });
  await enrollments.assign({ userId: 's1', courseId: course.id });
  await progress.upsert('s1', created.id, { status: 'complete', score: 0 });

  const view = await service.forStudent('s1', 't1');
  assert.equal(view.roadmaps.length, 1);
  assert.equal(view.roadmaps[0]?.title, 'Docker Deep Dive');
  assert.equal(view.roadmaps[0]?.slug, 'docker-deep-dive');
  assert.equal(view.roadmaps[0]?.lessonsTotal, 1);
  assert.equal(view.roadmaps[0]?.progress, 100);
});

test('rankings compare the student to the batch and the university', async () => {
  const { service, enrollments, progress } = build();
  await enrollments.assign({ userId: 's1', courseId: 'c1', batchId: 'b1' });
  await enrollments.assign({ userId: 's2', courseId: 'c1', batchId: 'b1' });
  // s1 scores highest, s2 middling; s3 is university-only with no score.
  await progress.upsert('s1', 'l1', { status: 'complete', score: 90 });
  await progress.upsert('s2', 'l1', { status: 'complete', score: 70 });

  const view = await service.forStudent('s1', 't1');
  const batch = view.rankings.find((r) => r.scope === 'batch');
  const university = view.rankings.find((r) => r.scope === 'university');

  assert.ok(batch, 'has a batch rank');
  assert.equal(batch?.rank, 1);
  assert.equal(batch?.total, 2);
  assert.equal(batch?.percentile, 100);

  assert.ok(university, 'has a university rank');
  assert.equal(university?.rank, 1);
  assert.equal(university?.total, 3);
  assert.equal(university?.averageScore, 90);
});

test('ties share the better rank (competition ranking)', async () => {
  const { service, enrollments, progress } = build();
  await enrollments.assign({ userId: 's1', courseId: 'c1', batchId: 'b1' });
  await enrollments.assign({ userId: 's2', courseId: 'c1', batchId: 'b1' });
  await progress.upsert('s1', 'l1', { status: 'complete', score: 80 });
  await progress.upsert('s2', 'l1', { status: 'complete', score: 80 });

  const view = await service.forStudent('s1', 't1');
  const batch = view.rankings.find((r) => r.scope === 'batch');
  assert.equal(batch?.rank, 1);
  assert.equal(batch?.total, 2);
});

test('a student with no batch has only a university rank', async () => {
  const { service, enrollments } = build();
  await enrollments.assign({ userId: 's1', courseId: 'c1' });
  const view = await service.forStudent('s1', 't1');
  assert.equal(view.rankings.some((r) => r.scope === 'batch'), false);
  assert.equal(view.rankings.some((r) => r.scope === 'university'), true);
});

test('profile completion counts each done item', async () => {
  const { service, enrollments, progress, snippets, gitConnections } = build();
  await enrollments.assign({ userId: 's1', courseId: 'c1', batchId: 'b1' });
  await progress.upsert('s1', 'l1', { status: 'complete', score: 90 });
  await snippets.create({
    userId: 's1',
    language: 'python',
    title: 'hello',
    source: 'print(1)',
    stdin: '',
  });
  await gitConnections.upsert({
    tenantId: 't1',
    userId: 's1',
    provider: 'github',
    login: 'octocat',
    tokenCiphertext: 'x',
    scopes: '',
  });

  const view = await service.forStudent('s1', 't1');
  // enrolled, started, completed, snippet, github = 5 of 7.
  assert.equal(view.profile.percent, Math.round((5 / 7) * 100));
  const done = view.profile.items.filter((i) => i.done).map((i) => i.key);
  assert.deepEqual(done, ['enrolled', 'progress', 'completed', 'snippet', 'github']);
});

test('a brand-new student has an empty profile', async () => {
  const { service } = build();
  const view = await service.forStudent('s1', 't1');
  assert.equal(view.profile.percent, 0);
  assert.equal(view.roadmaps.length, 0);
  assert.equal(view.studentName, 'Student One');
});

test('resume learning points at the first incomplete lesson', async () => {
  const { service, enrollments, progress } = build();
  await enrollments.assign({ userId: 's1', courseId: 'c1', batchId: 'b1' });
  await progress.upsert('s1', 'l1', { status: 'complete' });

  const view = await service.forStudent('s1', 't1');
  assert.ok(view.resume);
  assert.equal(view.resume?.lessonId, 'l2');
  assert.equal(view.resume?.courseSlug, 'k8s');
  assert.equal(view.resume?.href, '/courses/k8s/lessons/l2');
  assert.equal(view.resume?.progress, 50);
});

test('resume learning is null once every enrolled course is complete', async () => {
  const { service, enrollments, progress } = build();
  await enrollments.assign({ userId: 's1', courseId: 'c1', batchId: 'b1' });
  await progress.upsert('s1', 'l1', { status: 'complete' });
  await progress.upsert('s1', 'l2', { status: 'complete' });

  const view = await service.forStudent('s1', 't1');
  assert.equal(view.resume, null);
});

test('up next lists an outstanding project and an untaken assessment', async () => {
  const { service, enrollments, projects, submissions } = build();
  await enrollments.assign({ userId: 's1', courseId: 'c1', batchId: 'b1' });
  await projects.create({
    tenantId: 't1',
    title: 'Build a REST API',
    description: '',
    runtimeTier: 'tier_2_container',
    status: 'published',
    deadline: new Date('2026-02-01T00:00:00.000Z'),
    maxScore: 100,
  });

  const view = await service.forStudent('s1', 't1');
  const kinds = view.upNext.map((i) => i.kind);
  assert.ok(kinds.includes('project'));
  assert.ok(kinds.includes('assessment'));
  // Dated projects sort ahead of open-ended assessments.
  assert.equal(view.upNext[0]?.kind, 'project');
  assert.equal(view.upNext[0]?.dueAt, '2026-02-01T00:00:00.000Z');
  assert.ok(submissions);
});

test('a submitted project and a taken assessment drop out of up next', async () => {
  const { service, enrollments, projects, submissions } = build();
  await enrollments.assign({ userId: 's1', courseId: 'c1', batchId: 'b1' });
  const project = await projects.create({
    tenantId: 't1',
    title: 'Build a REST API',
    description: '',
    runtimeTier: 'tier_2_container',
    status: 'published',
    deadline: null,
    maxScore: 100,
  });
  await submissions.create({
    tenantId: 't1',
    projectId: project.id,
    componentId: 'comp-1',
    userId: 's1',
    workspaceId: 'ws-1',
    title: 'Done',
    description: '',
    githubUrl: null,
    demoUrl: null,
    status: 'submitted',
    score: null,
    feedback: null,
  });

  const view = await service.forStudent('s1', 't1');
  assert.equal(view.upNext.some((i) => i.kind === 'project'), false);
});

test('up next ignores projects in a tenant the student is not enrolled in', async () => {
  const { service, enrollments, projects } = build();
  await enrollments.assign({ userId: 's1', courseId: 'c1', batchId: 'b1' });
  await projects.create({
    tenantId: 'other-tenant',
    title: 'Other tenant project',
    description: '',
    runtimeTier: 'tier_2_container',
    status: 'published',
    deadline: null,
    maxScore: 100,
  });

  const view = await service.forStudent('s1', 't1');
  assert.equal(view.upNext.some((i) => i.kind === 'project'), false);
});

test('averageScore ignores ungraded rows', () => {
  assert.equal(averageScore([80, null, 90]), 85);
  assert.equal(averageScore([null, undefined]), null);
  assert.equal(averageScore([]), null);
});

test('percentileFor maps rank to a 0-100 scale', () => {
  assert.equal(percentileFor(1, 1), 100);
  assert.equal(percentileFor(1, 5), 100);
  assert.equal(percentileFor(5, 5), 0);
  assert.equal(percentileFor(3, 5), 50);
});
