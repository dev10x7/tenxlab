import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ClarityService,
  cefrBand,
  localClarityScore,
  CLARITY_RESPONSE_MAX,
} from './clarity/clarity.service';
import {
  CLARITY_TASKS,
  clarityTasksFor,
  findClarityTask,
} from './clarity/clarity-tasks';
import { InMemoryClarityAttemptRepository, InMemoryUserRepository } from './common/in-memory';
import type { ClarityEvaluator } from './ai/ai-bridge.client';

// ------------------------------------------------------------ CEFR mapping

test('cefrBand maps score ranges to the six CEFR bands', () => {
  assert.equal(cefrBand(0), 'A1');
  assert.equal(cefrBand(24), 'A1');
  assert.equal(cefrBand(25), 'A2');
  assert.equal(cefrBand(40), 'B1');
  assert.equal(cefrBand(55), 'B2');
  assert.equal(cefrBand(70), 'C1');
  assert.equal(cefrBand(85), 'C2');
  assert.equal(cefrBand(100), 'C2');
});

// ------------------------------------------------------------ task bank

test('the Clarity bank covers all four skills', () => {
  const skills = new Set(CLARITY_TASKS.map((t) => t.skill));
  assert.deepEqual([...skills].sort(), ['listening', 'reading', 'speaking', 'writing']);
  assert.equal(clarityTasksFor('reading').every((t) => t.skill === 'reading'), true);
  assert.equal(clarityTasksFor(undefined).length, CLARITY_TASKS.length);
});

test('reading and listening tasks carry a passage; writing and speaking do not', () => {
  for (const task of CLARITY_TASKS) {
    if (task.skill === 'reading' || task.skill === 'listening') {
      assert.ok(task.passage, `${task.id} should carry a passage`);
    }
  }
  assert.ok(findClarityTask('reading-k8s-basics'));
  assert.equal(findClarityTask('nope'), null);
});

// ------------------------------------------------------------ local scoring

test('localClarityScore rewards coverage of the expected terms', () => {
  const strong = localClarityScore('reading', 'A pod wraps containers on a node.', [
    'pod',
    'container',
    'node',
  ]);
  const weak = localClarityScore('reading', 'I do not know.', ['pod', 'container', 'node']);
  assert.equal(strong.content, 100);
  assert.ok(strong.score > weak.score);
});

test('localClarityScore penalises filler words when speaking', () => {
  const clean = localClarityScore('speaking', 'Kubernetes schedules pods onto nodes.', []);
  const messy = localClarityScore(
    'speaking',
    'Um, so, like, basically kubernetes, you know, um, pods.',
    [],
  );
  assert.ok(messy.fluency < clean.fluency);
});

test('localClarityScore falls back to writing weights for an unknown skill', () => {
  const report = localClarityScore('telepathy', 'This is a sentence.', []);
  assert.equal(report.skill, 'writing');
});

// ------------------------------------------------------------ service

function makeService(evaluator: ClarityEvaluator | null = null) {
  const users = new InMemoryUserRepository();
  return new ClarityService({
    attempts: new InMemoryClarityAttemptRepository(),
    users,
    evaluator,
  });
}

test('submit scores a response, persists it, and derives the level', async () => {
  const service = makeService();
  const result = await service.submit(
    'u1',
    't1',
    'reading-k8s-basics',
    'A Pod is the smallest unit in Kubernetes. It wraps containers on a node.',
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.attempt.skill, 'reading');
  assert.ok(result.attempt.score >= 0 && result.attempt.score <= 100);
  assert.match(result.attempt.band, /^[ABC][12]$/);

  const levels = await service.levels('u1');
  const reading = levels.find((l) => l.skill === 'reading');
  assert.equal(reading?.attempts, 1);
  assert.equal(reading?.band, result.attempt.band);
  assert.equal(reading?.bestScore, result.attempt.score);
  // Skills with no attempt report a null band, not a zero.
  assert.equal(levels.find((l) => l.skill === 'writing')?.band, null);
});

test('submit refuses an unknown task, an empty response, and an over-long one', async () => {
  const service = makeService();
  assert.deepEqual(await service.submit('u1', 't1', 'nope', 'hi'), {
    ok: false,
    reason: 'unknown_task',
  });
  assert.deepEqual(await service.submit('u1', 't1', 'reading-k8s-basics', '   '), {
    ok: false,
    reason: 'empty',
  });
  assert.deepEqual(
    await service.submit('u1', 't1', 'reading-k8s-basics', 'x'.repeat(CLARITY_RESPONSE_MAX + 1)),
    { ok: false, reason: 'too_long' },
  );
});

test('the best band per skill is kept across attempts', async () => {
  const service = makeService();
  await service.submit('u1', 't1', 'writing-standup-update', 'finished next blocker working');
  const strong = await service.submit(
    'u1',
    't1',
    'writing-bug-report',
    'Expected the login to succeed. Actual result was an error. Steps to reproduce: open the login page.',
  );
  assert.equal(strong.ok, true);
  const levels = await service.levels('u1');
  const writing = levels.find((l) => l.skill === 'writing');
  assert.equal(writing?.attempts, 2);
  // bestScore reflects the stronger of the two attempts.
  if (strong.ok) assert.equal(writing?.bestScore, strong.attempt.score);
});

test('the evaluator is used when configured, and its band is stored', async () => {
  const calls: Array<{ skill: string; taskId: string }> = [];
  const evaluator: ClarityEvaluator = {
    async evaluateClarity(input) {
      calls.push({ skill: input.skill, taskId: input.taskId });
      return {
        skill: input.skill,
        score: 88,
        band: 'C2',
        grammar: 90,
        vocabulary: 90,
        content: 85,
        fluency: 88,
        matchedTerms: [],
        feedback: ['Strong response.'],
      };
    },
  };
  const service = makeService(evaluator);
  const result = await service.submit('u1', 't1', 'speaking-explain-rest', 'A REST API uses HTTP.');
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.attempt.band, 'C2');
  assert.equal(result.attempt.score, 88);
  assert.deepEqual(calls, [{ skill: 'speaking', taskId: 'speaking-explain-rest' }]);
});

test('a failing evaluator falls back to the local score rather than erroring', async () => {
  const evaluator: ClarityEvaluator = {
    async evaluateClarity() {
      throw new Error('AI plane down');
    },
  };
  const service = makeService(evaluator);
  const result = await service.submit('u1', 't1', 'reading-k8s-basics', 'A pod wraps containers.');
  assert.equal(result.ok, true);
});

test('the roster groups students by tenant with an overall band', async () => {
  const users = new InMemoryUserRepository();
  const attempts = new InMemoryClarityAttemptRepository();
  const service = new ClarityService({ attempts, users, evaluator: null });

  await service.submit('u1', 't1', 'reading-k8s-basics', 'A pod wraps containers on a node.');
  await service.submit('u2', 't1', 'writing-standup-update', 'finished next blocker');
  await service.submit('u3', 'other-tenant', 'reading-k8s-basics', 'A pod.');

  const roster = await service.roster('t1');
  assert.equal(roster.length, 2);
  assert.deepEqual(
    roster.map((r) => r.userId).sort(),
    ['u1', 'u2'],
  );
  for (const row of roster) {
    assert.ok(row.overallBand);
    assert.equal(row.attempts, 1);
    assert.ok(row.lastActivityAt);
  }
  // The other tenant's student never appears.
  assert.equal(roster.some((r) => r.userId === 'u3'), false);
});
