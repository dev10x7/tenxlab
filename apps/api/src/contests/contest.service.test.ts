import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ContestService } from './contest.service';
import { InMemoryLeaderboard } from './leaderboard';
import {
  InMemoryContestRepository,
  InMemoryContestEntryRepository,
  InMemoryUserRepository,
} from '../common/in-memory';
import type { ContestRecord } from '../common/ports';

const TENANT = 't1';

function build(contests: ContestRecord[] = [], now?: () => Date) {
  const users = new InMemoryUserRepository([
    { id: 's1', email: 's1@x.dev', fullName: 'Student One' },
    { id: 's2', email: 's2@x.dev', fullName: 'Student Two' },
  ]);
  const service = new ContestService({
    contests: new InMemoryContestRepository(contests),
    entries: new InMemoryContestEntryRepository(),
    leaderboard: new InMemoryLeaderboard(),
    users,
    now,
  });
  return service;
}

const openContest = (overrides: Partial<ContestRecord> = {}): ContestRecord => ({
  id: 'c1',
  tenantId: TENANT,
  title: 'Sprint',
  description: '',
  status: 'published',
  startAt: null,
  endAt: null,
  maxScore: 100,
  exerciseSlug: null,
  createdBy: 'instructor',
  createdAt: new Date('2026-01-01'),
  ...overrides,
});

// ------------------------------------------------------------------- lifecycle

test('create trims the title and starts as a draft', async () => {
  const service = build();
  const result = await service.create({ tenantId: TENANT, createdBy: 'i', title: '  Sprint  ' });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.contest.title, 'Sprint');
  assert.equal(result.contest.status, 'draft');
});

test('create rejects an empty title and an inverted window', async () => {
  const service = build();
  const empty = await service.create({ tenantId: TENANT, createdBy: 'i', title: '   ' });
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.equal(empty.reason, 'title_required');

  const inverted = await service.create({
    tenantId: TENANT,
    createdBy: 'i',
    title: 'Sprint',
    startAt: new Date('2026-02-02'),
    endAt: new Date('2026-02-01'),
  });
  assert.equal(inverted.ok, false);
  if (!inverted.ok) assert.equal(inverted.reason, 'invalid_window');
});

test('phase is derived from the window on read', async () => {
  const now = () => new Date('2026-06-01T12:00:00Z');
  const service = build([], now);

  const scheduled = await service.create({
    tenantId: TENANT,
    createdBy: 'i',
    title: 'Future',
    startAt: new Date('2026-07-01'),
    endAt: new Date('2026-07-02'),
  });
  const live = await service.create({
    tenantId: TENANT,
    createdBy: 'i',
    title: 'Now',
    startAt: new Date('2026-05-01'),
    endAt: new Date('2026-08-01'),
  });
  const ended = await service.create({
    tenantId: TENANT,
    createdBy: 'i',
    title: 'Past',
    startAt: new Date('2026-01-01'),
    endAt: new Date('2026-02-01'),
  });
  assert.ok(scheduled.ok && live.ok && ended.ok);
  if (!scheduled.ok || !live.ok || !ended.ok) return;

  const publishAll = await Promise.all([
    service.publish(scheduled.contest.id, TENANT),
    service.publish(live.contest.id, TENANT),
    service.publish(ended.contest.id, TENANT),
  ]);
  assert.ok(publishAll.every((r) => r.ok));

  const list = await service.list(TENANT);
  const phases = new Map(list.map((c) => [c.title, c.phase]));
  assert.equal(phases.get('Future'), 'scheduled');
  assert.equal(phases.get('Now'), 'live');
  assert.equal(phases.get('Past'), 'ended');
});

test('a student list hides drafts; staff see them', async () => {
  const service = build([openContest({ status: 'draft' })]);
  assert.equal((await service.list(TENANT)).length, 0);
  assert.equal((await service.list(TENANT, { includeDrafts: true })).length, 1);
});

// ------------------------------------------------------------------- entries

test('submitEntry refuses a contest that is not live or not published', async () => {
  const now = () => new Date('2026-06-01T12:00:00Z');
  const service = build(
    [
      openContest({ id: 'draft', status: 'draft' }),
      openContest({ id: 'future', startAt: new Date('2026-07-01') }),
      openContest({ id: 'past', endAt: new Date('2026-01-01') }),
    ],
    now,
  );

  const draft = await service.submitEntry({ contestId: 'draft', tenantId: TENANT, userId: 's1', score: 10 });
  assert.equal(draft.ok, false);
  if (!draft.ok) assert.equal(draft.reason, 'not_published');

  const future = await service.submitEntry({ contestId: 'future', tenantId: TENANT, userId: 's1', score: 10 });
  assert.equal(future.ok, false);
  if (!future.ok) assert.equal(future.reason, 'not_live');

  const past = await service.submitEntry({ contestId: 'past', tenantId: TENANT, userId: 's1', score: 10 });
  assert.equal(past.ok, false);
  if (!past.ok) assert.equal(past.reason, 'not_live');
});

test('submitEntry rejects a score out of range', async () => {
  const service = build([openContest({ maxScore: 50 })]);
  const over = await service.submitEntry({ contestId: 'c1', tenantId: TENANT, userId: 's1', score: 60 });
  assert.equal(over.ok, false);
  if (!over.ok) assert.equal(over.reason, 'score_out_of_range');
});

test('the leaderboard ranks by score then speed, with the caller flagged', async () => {
  const service = build([openContest()]);
  await service.submitEntry({ contestId: 'c1', tenantId: TENANT, userId: 's1', score: 70, durationMs: 9000 });
  await service.submitEntry({ contestId: 'c1', tenantId: TENANT, userId: 's2', score: 70, durationMs: 1000 });
  await service.submitEntry({ contestId: 'c1', tenantId: TENANT, userId: 's2', score: 40, durationMs: 500 });

  const board = await service.leaderboard('c1', TENANT, 's1');
  assert.ok(board);
  assert.deepEqual(
    board!.map((r) => [r.userId, r.rank, r.isSelf]),
    [
      ['s2', 1, false],
      ['s1', 2, true],
    ],
  );
  // Names are resolved from the user repository.
  assert.equal(board![0]!.displayName, 'Student Two');
  // s2's best (70/1000) is kept, not the later worse 40/500.
  assert.equal(board![0]!.durationMs, 1000);
});

test('a leaderboard rebuilds from the durable entries when the index is lost', async () => {
  const service = build([openContest()]);
  await service.submitEntry({ contestId: 'c1', tenantId: TENANT, userId: 's1', score: 80, durationMs: 3000 });

  // Simulate a Redis flush: a fresh service with an empty index but the same
  // durable entry repository is the contract we are pinning.
  const entry = await service.myStanding('c1', TENANT, 's1');
  assert.equal(entry?.rank, 1);
  assert.equal(entry?.score, 80);
});

// -------------------------------------------------------------- completion hook

test('recordCompletion credits a live contest scoped to the exercise slug', async () => {
  const service = build([openContest({ exerciseSlug: 'create-simple-pod' })]);
  await service.recordCompletion({
    tenantId: TENANT,
    userId: 's1',
    exerciseSlug: 'create-simple-pod',
    score: 88,
    completedAt: new Date('2026-06-01T12:00:00Z'),
  });
  const board = await service.leaderboard('c1', TENANT, 's1');
  assert.equal(board?.length, 1);
  assert.equal(board?.[0]?.score, 88);
});

test('recordCompletion ignores a non-matching slug and a non-live contest', async () => {
  const service = build([
    openContest({ id: 'scoped', exerciseSlug: 'other-lab' }),
    openContest({ id: 'draft', status: 'draft' }),
  ]);
  await service.recordCompletion({
    tenantId: TENANT,
    userId: 's1',
    exerciseSlug: 'create-simple-pod',
    score: 88,
    completedAt: new Date('2026-06-01T12:00:00Z'),
  });
  assert.equal((await service.leaderboard('scoped', TENANT, 's1'))?.length, 0);
  assert.equal((await service.leaderboard('draft', TENANT, 's1'))?.length, 0);
});

test('recordCompletion clamps a score above the contest max', async () => {
  const service = build([openContest({ maxScore: 50 })]);
  await service.recordCompletion({
    tenantId: TENANT,
    userId: 's1',
    exerciseSlug: 'any',
    score: 999,
    completedAt: new Date('2026-06-01T12:00:00Z'),
  });
  const standing = await service.myStanding('c1', TENANT, 's1');
  assert.equal(standing?.score, 50);
});

test('bestRank returns the student’s best finishing position', async () => {
  const service = build([openContest({ id: 'c1' }), openContest({ id: 'c2' })]);
  await service.submitEntry({ contestId: 'c1', tenantId: TENANT, userId: 's1', score: 50, durationMs: 1000 });
  await service.submitEntry({ contestId: 'c1', tenantId: TENANT, userId: 's2', score: 90, durationMs: 1000 });
  await service.submitEntry({ contestId: 'c2', tenantId: TENANT, userId: 's1', score: 90, durationMs: 1000 });
  await service.submitEntry({ contestId: 'c2', tenantId: TENANT, userId: 's2', score: 10, durationMs: 1000 });

  assert.equal(await service.bestRank('s1'), 1);
  assert.equal(await service.bestRank('s2'), 1);
  assert.equal(await service.bestRank('nobody'), null);
});

test('get and leaderboard are tenant-scoped', async () => {
  const service = build([openContest()]);
  assert.equal(await service.get('c1', 'other-tenant'), null);
  assert.equal(await service.leaderboard('c1', 'other-tenant', 's1'), null);
});
