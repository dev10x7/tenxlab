import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AttendanceService, summarize } from './attendance.service';
import {
  InMemoryAttendanceRepository,
  InMemoryBatchRepository,
  InMemoryClassSessionRepository,
  InMemoryEnrollmentRepository,
  InMemoryUserRepository,
} from '../common/in-memory';

function fixture() {
  const batches = new InMemoryBatchRepository([
    { id: 'b1', tenantId: 't1', name: 'Batch One' },
    { id: 'b2', tenantId: 't2', name: 'Other Tenant' },
  ]);
  const classSessions = new InMemoryClassSessionRepository();
  const attendance = new InMemoryAttendanceRepository();
  const enrollments = new InMemoryEnrollmentRepository();
  const users = new InMemoryUserRepository([
    { id: 's1', email: 's1@x.dev', fullName: 'Student One' },
    { id: 's2', email: 's2@x.dev', fullName: 'Student Two' },
  ]);
  const service = new AttendanceService({
    batches,
    sessions: classSessions,
    attendance,
    enrollments,
    users,
  });
  return { service, batches, classSessions, attendance, enrollments };
}

async function seedSessions(
  ctx: ReturnType<typeof fixture>,
  count: number,
): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const s = await ctx.classSessions.create({
      batchId: 'b1',
      title: `Class ${i + 1}`,
      scheduledAt: new Date(`2026-02-0${i + 1}T09:00:00Z`),
    });
    ids.push(s.id);
  }
  return ids;
}

test('summarize: present + late count as attended, excused leaves the denominator', () => {
  const summary = summarize(['present', 'late', 'absent', 'excused', 'not_marked']);
  assert.equal(summary.counts.present, 1);
  assert.equal(summary.counts.late, 1);
  assert.equal(summary.counts.absent, 1);
  assert.equal(summary.counts.excused, 1);
  assert.equal(summary.counts.marked, 4);
  // 2 attended / (4 marked - 1 excused) = 67%.
  assert.equal(summary.percent, 67);
});

test('summarize: an empty or unmarked set is zero, never NaN', () => {
  assert.equal(summarize([]).percent, 0);
  assert.equal(summarize(['not_marked', 'not_marked']).percent, 0);
  assert.equal(summarize(['excused']).percent, 0);
});

test('mark records a status and is idempotent per (session, user)', async () => {
  const ctx = fixture();
  const [sessionId] = await seedSessions(ctx, 1);
  const first = await ctx.service.mark({
    sessionId: sessionId!,
    tenantId: 't1',
    userId: 's1',
    status: 'present',
  });
  assert.deepEqual(first, { ok: true });
  // A correction updates rather than duplicating.
  await ctx.service.mark({
    sessionId: sessionId!,
    tenantId: 't1',
    userId: 's1',
    status: 'late',
  });
  const rows = await ctx.attendance.listBySession(sessionId!);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.status, 'late');
});

test('mark rejects an unknown status', async () => {
  const ctx = fixture();
  const [sessionId] = await seedSessions(ctx, 1);
  const result = await ctx.service.mark({
    sessionId: sessionId!,
    tenantId: 't1',
    userId: 's1',
    status: 'teleported',
  });
  assert.deepEqual(result, { ok: false, reason: 'invalid_status' });
});

test('mark rejects a session outside the tenant', async () => {
  const ctx = fixture();
  const session = await ctx.classSessions.create({
    batchId: 'b2',
    title: 'Other class',
    scheduledAt: new Date('2026-02-01T09:00:00Z'),
  });
  const result = await ctx.service.mark({
    sessionId: session.id,
    tenantId: 't1',
    userId: 's1',
    status: 'present',
  });
  assert.deepEqual(result, { ok: false, reason: 'session_not_found' });
});

test('studentView: overall percent and session-level breakdown', async () => {
  const ctx = fixture();
  const ids = await seedSessions(ctx, 3);
  await ctx.enrollments.assign({ userId: 's1', courseId: 'c1', batchId: 'b1' });
  await ctx.service.mark({ sessionId: ids[0]!, tenantId: 't1', userId: 's1', status: 'present' });
  await ctx.service.mark({ sessionId: ids[1]!, tenantId: 't1', userId: 's1', status: 'absent' });
  await ctx.service.mark({ sessionId: ids[2]!, tenantId: 't1', userId: 's1', status: 'late' });

  const view = await ctx.service.studentView('s1', 't1');
  assert.equal(view.sessions.length, 3);
  assert.deepEqual(
    view.sessions.map((s) => s.status),
    ['present', 'absent', 'late'],
  );
  // 2 attended / 3 marked = 67%.
  assert.equal(view.overall.percent, 67);
});

test('studentView: sessions without a record read as not_marked and are excluded', async () => {
  const ctx = fixture();
  const ids = await seedSessions(ctx, 2);
  await ctx.enrollments.assign({ userId: 's1', courseId: 'c1', batchId: 'b1' });
  await ctx.service.mark({ sessionId: ids[0]!, tenantId: 't1', userId: 's1', status: 'present' });

  const view = await ctx.service.studentView('s1', 't1');
  assert.equal(view.sessions[1]?.status, 'not_marked');
  assert.equal(view.overall.percent, 100);
  assert.equal(view.overall.counts.marked, 1);
});

test('studentView: no enrolments means an empty view', async () => {
  const ctx = fixture();
  await seedSessions(ctx, 2);
  const view = await ctx.service.studentView('s1', 't1');
  assert.equal(view.sessions.length, 0);
  assert.equal(view.overall.percent, 0);
});

test('batchView: a roster x sessions matrix with per-student percent', async () => {
  const ctx = fixture();
  const ids = await seedSessions(ctx, 2);
  await ctx.enrollments.assign({ userId: 's1', courseId: 'c1', batchId: 'b1' });
  await ctx.enrollments.assign({ userId: 's2', courseId: 'c1', batchId: 'b1' });
  await ctx.service.mark({ sessionId: ids[0]!, tenantId: 't1', userId: 's1', status: 'present' });
  await ctx.service.mark({ sessionId: ids[1]!, tenantId: 't1', userId: 's1', status: 'present' });
  await ctx.service.mark({ sessionId: ids[0]!, tenantId: 't1', userId: 's2', status: 'absent' });

  const view = await ctx.service.batchView('b1', 't1');
  assert.ok(view);
  assert.equal(view?.sessions.length, 2);
  assert.equal(view?.rows.length, 2);
  const one = view?.rows.find((r) => r.userId === 's1');
  const two = view?.rows.find((r) => r.userId === 's2');
  assert.equal(one?.percent, 100);
  assert.deepEqual(one?.cells.map((c) => c.status), ['present', 'present']);
  // s2 has one absent and one not_marked: 0% over the single marked session.
  assert.equal(two?.percent, 0);
  assert.deepEqual(two?.cells.map((c) => c.status), ['absent', 'not_marked']);
});

test('batchView is null outside the tenant', async () => {
  const ctx = fixture();
  assert.equal(await ctx.service.batchView('b2', 't1'), null);
  assert.equal(await ctx.service.batchView('missing', 't1'), null);
});

test('createSession rejects a batch outside the tenant', async () => {
  const ctx = fixture();
  const created = await ctx.service.createSession({
    batchId: 'b2',
    tenantId: 't1',
    title: 'Nope',
    scheduledAt: '2026-02-01T09:00:00Z',
  });
  assert.equal(created, null);
});

test('listSessions returns sessions oldest first', async () => {
  const ctx = fixture();
  await seedSessions(ctx, 3);
  const list = await ctx.service.listSessions('b1', 't1');
  assert.equal(list?.length, 3);
  assert.deepEqual(
    list?.map((s) => s.title),
    ['Class 1', 'Class 2', 'Class 3'],
  );
});
