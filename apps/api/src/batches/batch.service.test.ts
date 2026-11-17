import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BatchService } from './batch.service';
import {
  InMemoryBatchRepository,
  InMemoryCourseRepository,
  InMemoryEnrollmentRepository,
  InMemoryLessonRepository,
  InMemoryMembershipRepository,
  InMemoryModuleRepository,
  InMemoryProgressRepository,
  InMemoryUserRepository,
} from '../common/in-memory';
import { courseCatalogFrom } from '../catalog/course-catalog';
import { createDemoState } from '../demo/state';
import { DEMO_BATCH, DEMO_COURSES } from '../catalog/demo-data';

const LESSONS = DEMO_COURSES[0]?.lessons.map((l) => ({ id: l.id, title: l.title })) ?? [];

/** A catalog whose course `c1` holds the demo course's lessons. */
function demoCatalog() {
  const courses = new InMemoryCourseRepository([
    {
      id: 'c1',
      tenantId: 't1',
      slug: 'c1',
      title: 'Course One',
      description: '',
      status: 'published',
      createdAt: new Date('2026-01-01'),
    },
  ]);
  const modules = new InMemoryModuleRepository([
    { id: 'cm1', courseId: 'c1', title: 'Module', position: 0 },
  ]);
  const lessons = new InMemoryLessonRepository(
    (DEMO_COURSES[0]?.lessons ?? []).map((l, i) => ({
      id: l.id,
      moduleId: 'cm1',
      title: l.title,
      type: l.type,
      maxScore: l.maxScore,
      position: i,
    })),
  );
  return courseCatalogFrom(courses, modules, lessons);
}

function buildService() {
  const batches = new InMemoryBatchRepository();
  const enrollments = new InMemoryEnrollmentRepository();
  const memberships = new InMemoryMembershipRepository([
    { id: 'm1', userId: 's1', tenantId: 't1', role: 'student', status: 'active' },
    { id: 'm2', userId: 'i1', tenantId: 't1', role: 'instructor', status: 'active' },
  ]);
  const users = new InMemoryUserRepository([
    { id: 's1', email: 's1@x.dev', fullName: 'Student One' },
    { id: 'i1', email: 'i1@x.dev', fullName: 'Instructor One' },
  ]);
  const progress = new InMemoryProgressRepository();
  const service = new BatchService(
    batches,
    enrollments,
    memberships,
    users,
    progress,
    demoCatalog(),
  );
  return { service, batches, enrollments, progress };
}

test('createBatch persists a batch scoped to the tenant', async () => {
  const { service } = buildService();
  const created = await service.createBatch({ tenantId: 't1', name: 'Batch A' });
  assert.equal(created.name, 'Batch A');
  assert.equal(created.studentCount, 0);

  const list = await service.listBatches('t1');
  assert.equal(list.length, 1);
  assert.equal(list[0]?.name, 'Batch A');
});

test('listBatches is tenant-scoped', async () => {
  const { service } = buildService();
  await service.createBatch({ tenantId: 't1', name: 'Batch A' });
  assert.equal((await service.listBatches('other')).length, 0);
});

test('listBatches lists populated cohorts first', async () => {
  const { service } = buildService();
  const empty = await service.createBatch({ tenantId: 't1', name: 'A — empty' });
  const populated = await service.createBatch({ tenantId: 't1', name: 'B — populated' });
  await service.assign({
    batchId: populated.id,
    userId: 's1',
    courseId: 'c1',
    tenantId: 't1',
  });

  const list = await service.listBatches('t1');
  assert.deepEqual(list.map((b) => b.id), [populated.id, empty.id]);
});

test('assign enrols a student and is idempotent', async () => {
  const { service } = buildService();
  const batch = await service.createBatch({ tenantId: 't1', name: 'Batch A' });

  const first = await service.assign({
    batchId: batch.id,
    userId: 's1',
    courseId: 'c1',
    tenantId: 't1',
  });
  assert.deepEqual(first, { ok: true });

  // Re-assigning the same student must not create a second enrolment row.
  await service.assign({ batchId: batch.id, userId: 's1', courseId: 'c1', tenantId: 't1' });

  const list = await service.listBatches('t1');
  assert.equal(list[0]?.studentCount, 1);
  const roster = await service.roster(batch.id, 't1');
  assert.deepEqual(roster?.map((r) => r.userId), ['s1']);
});

test('assign rejects a non-student', async () => {
  const { service } = buildService();
  const batch = await service.createBatch({ tenantId: 't1', name: 'Batch A' });
  const result = await service.assign({
    batchId: batch.id,
    userId: 'i1',
    courseId: 'c1',
    tenantId: 't1',
  });
  assert.deepEqual(result, { ok: false, reason: 'not_a_student' });
});

test('assign rejects an unknown batch', async () => {
  const { service } = buildService();
  const result = await service.assign({
    batchId: 'nope',
    userId: 's1',
    courseId: 'c1',
    tenantId: 't1',
  });
  assert.deepEqual(result, { ok: false, reason: 'batch_not_found' });
});

test('roster and gradebook return null for a foreign batch', async () => {
  const { service } = buildService();
  const batch = await service.createBatch({ tenantId: 't1', name: 'Batch A' });
  assert.equal(await service.roster(batch.id, 'other'), null);
  assert.equal(await service.gradebook(batch.id, 'other'), null);
});

test('gradebook aggregates landed scores against the course lessons', async () => {
  const { service, progress } = buildService();
  const batch = await service.createBatch({ tenantId: 't1', name: 'Batch A' });
  await service.assign({ batchId: batch.id, userId: 's1', courseId: 'c1', tenantId: 't1' });

  // Simulate the gradebook webhook landing a score for the lab lesson.
  const labLesson = LESSONS.find((l) => l.id === 'k8s-l2');
  assert.ok(labLesson);
  await progress.upsert('s1', 'k8s-l2', { status: 'complete', score: 90 });

  const gb = await service.gradebook(batch.id, 't1');
  assert.ok(gb);
  assert.equal(gb.rows.length, 1);
  const row = gb.rows[0];
  assert.equal(row?.userId, 's1');
  assert.equal(row?.averageScore, 90);
  assert.equal(row?.completed, 1);
  assert.equal(row?.total, LESSONS.length);
  assert.equal(row?.cells.find((c) => c.lessonId === 'k8s-l2')?.score, 90);
  assert.equal(row?.cells.find((c) => c.lessonId === 'k8s-l1')?.status, 'not_started');
});

test('gradebook reports a null average when nothing is graded', async () => {
  const { service } = buildService();
  const batch = await service.createBatch({ tenantId: 't1', name: 'Batch A' });
  await service.assign({ batchId: batch.id, userId: 's1', courseId: 'c1', tenantId: 't1' });
  const gb = await service.gradebook(batch.id, 't1');
  assert.equal(gb?.rows[0]?.averageScore, null);
});

test('listStudents returns only students of the tenant', async () => {
  const { service } = buildService();
  const students = await service.listStudents('t1');
  assert.deepEqual(students.map((s) => s.userId), ['s1']);
});

test('the seeded demo state has a batch with the demo student enrolled', async () => {
  const state = createDemoState();
  const batches = await state.batches.listByTenant('demo-tenant');
  assert.equal(batches.length, 1);
  assert.equal(batches[0]?.id, DEMO_BATCH.id);
  const roster = await state.enrollments.listByBatch(DEMO_BATCH.id);
  assert.deepEqual(roster.map((e) => e.userId), ['demo-student']);
});

test('gradebook columns come from the enrolled course, not a fixed list', async () => {
  // A course authored after the demo corpus still contributes its lessons.
  const courses = new InMemoryCourseRepository([
    {
      id: 'authored',
      tenantId: 't1',
      slug: 'docker-deep-dive',
      title: 'Docker Deep Dive',
      description: '',
      status: 'published',
      createdAt: new Date('2026-06-01'),
    },
  ]);
  const modules = new InMemoryModuleRepository([
    { id: 'dm1', courseId: 'authored', title: 'Containers', position: 0 },
  ]);
  const lessons = new InMemoryLessonRepository([
    { id: 'dl1', moduleId: 'dm1', title: 'Images', type: 'reading', maxScore: 0, position: 0 },
    { id: 'dl2', moduleId: 'dm1', title: 'Compose', type: 'interactive_lab', maxScore: 100, position: 1 },
  ]);
  const progress = new InMemoryProgressRepository();
  const enrollments = new InMemoryEnrollmentRepository();
  const batches = new InMemoryBatchRepository();
  const service = new BatchService(
    batches,
    enrollments,
    new InMemoryMembershipRepository([
      { id: 'm1', userId: 's1', tenantId: 't1', role: 'student', status: 'active' },
    ]),
    new InMemoryUserRepository([
      { id: 's1', email: 's1@x.dev', fullName: 'Student One' },
    ]),
    progress,
    courseCatalogFrom(courses, modules, lessons),
  );

  const batch = await service.createBatch({ tenantId: 't1', name: 'Batch A' });
  await service.assign({ batchId: batch.id, userId: 's1', courseId: 'authored', tenantId: 't1' });
  await progress.upsert('s1', 'dl2', { status: 'complete', score: 88 });

  const gb = await service.gradebook(batch.id, 't1');
  assert.deepEqual(gb?.lessons.map((l) => l.id), ['dl1', 'dl2']);
  const row = gb?.rows[0];
  assert.equal(row?.total, 2);
  assert.equal(row?.completed, 1);
  assert.equal(row?.averageScore, 88);
  assert.equal(row?.cells.find((c) => c.lessonId === 'dl2')?.score, 88);
});
