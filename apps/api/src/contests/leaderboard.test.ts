import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  beats,
  rankEntries,
  InMemoryLeaderboard,
  type LeaderboardEntry,
} from './leaderboard';
import { compositeScore, SCORE_SCALE } from './redis-leaderboard';

const at = (ms: number) => new Date(1_700_000_000_000 + ms);
const entry = (userId: string, score: number, durationMs: number, t = 0): LeaderboardEntry => ({
  userId,
  score,
  durationMs,
  submittedAt: at(t),
});

test('beats: a higher score always wins', () => {
  assert.equal(beats(entry('a', 50, 1000), entry('a', 60, 99999)), true);
  assert.equal(beats(entry('a', 60, 1000), entry('a', 50, 1)), false);
});

test('beats: an equal score is won by the faster time', () => {
  assert.equal(beats(entry('a', 60, 5000), entry('a', 60, 4000)), true);
  assert.equal(beats(entry('a', 60, 4000), entry('a', 60, 5000)), false);
});

test('beats: an exact tie keeps the earlier submission', () => {
  assert.equal(beats(entry('a', 60, 4000, 100), entry('a', 60, 4000, 50)), true);
  assert.equal(beats(entry('a', 60, 4000, 50), entry('a', 60, 4000, 100)), false);
});

test('rankEntries: score desc, then duration asc, then earliest', () => {
  const ranked = rankEntries([
    entry('slow', 80, 9000),
    entry('fast', 80, 1000),
    entry('top', 95, 5000),
    entry('tie-earlier', 70, 1000, 10),
    entry('tie-later', 70, 1000, 20),
  ]);
  assert.deepEqual(
    ranked.map((e) => e.userId),
    ['top', 'fast', 'slow', 'tie-earlier', 'tie-later'],
  );
});

test('InMemoryLeaderboard keeps only a student’s best entry', async () => {
  const board = new InMemoryLeaderboard();
  await board.record('c1', entry('a', 50, 5000));
  await board.record('c1', entry('a', 40, 1000)); // worse score: ignored
  await board.record('c1', entry('a', 50, 2000)); // same score, faster: kept
  const found = await board.find('c1', 'a');
  assert.equal(found?.score, 50);
  assert.equal(found?.durationMs, 2000);
});

test('InMemoryLeaderboard.top orders and limits', async () => {
  const board = new InMemoryLeaderboard();
  await board.record('c1', entry('a', 50, 5000));
  await board.record('c1', entry('b', 90, 1000));
  await board.record('c1', entry('c', 70, 1000));
  const top = await board.top('c1', 2);
  assert.deepEqual(
    top.map((e) => e.userId),
    ['b', 'c'],
  );
});

test('compositeScore orders score first, then the faster duration', () => {
  // A higher score must outrank a faster time on a lower score.
  assert.ok(compositeScore(90, 10_000) > compositeScore(80, 1));
  // Equal score: the faster (smaller duration) has the larger composite.
  assert.ok(compositeScore(80, 1000) > compositeScore(80, 5000));
  // Durations past the scale are clamped rather than wrapping the score.
  assert.ok(compositeScore(80, SCORE_SCALE * 5) > compositeScore(79, 0));
});
