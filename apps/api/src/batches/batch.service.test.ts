import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BatchService } from './batch.service';
import {
  InMemoryBatchRepository,
  InMemoryEnrollmentRepository,
  InMemoryMembershipRepository,
  InMemoryProgressRepository,
  InMemoryUserRepository,
} from '../common/in-memory';
import { createDemoState } from '../demo/state';
import { DEMO_BATCH, DEMO_COURSES } from '../catalog/demo-data';

const LESSONS = DEMO_COURSES[0]?.lessons.map((l) => ({ id: l.id, title: l.title })) ?? [];

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
  const service = new BatchService(batches, enrollments, memberships, users, progress, LESSONS);
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
