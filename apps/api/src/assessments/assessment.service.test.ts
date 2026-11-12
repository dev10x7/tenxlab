import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CodeRunResult } from '@tenxlab/contracts';
import type { CodeExecutionProvider, CodeRunInput } from '@tenxlab/lab-provider';
import { InMemoryAttemptRepository } from '../common/in-memory';
import { AssessmentService } from './assessment.service';
import { DEMO_ASSESSMENTS } from './demo-assessments';

/** A clock whose time can be advanced, so the exam window is deterministic. */
function stepClock(startIso: string) {
  let t = new Date(startIso).getTime();
  return {
    now: () => new Date(t),
    advance(seconds: number) {
      t += seconds * 1000;
    },
  };
}

/** Records runs and returns canned output keyed by stdin (falls back to `stdout`). */
function fakeRunner(outputs: Record<string, string> = {}, stdout = '2.0\n') {
  const calls: CodeRunInput[] = [];
  const provider: CodeExecutionProvider = {
    name: 'fake',
    async run(input) {
      calls.push(input);
      const result: CodeRunResult = {
        stdout: outputs[input.stdin ?? ''] ?? stdout,
        stderr: '',
        exitCode: 0,
        executionTimeMs: 1,
        timedOut: false,
        unsupported: false,
      };
      return result;
    },
  };
  return { calls, provider };
}

function service(runner: CodeExecutionProvider | null = null) {
  return new AssessmentService({
    attempts: new InMemoryAttemptRepository(),
    runner,
    assessments: DEMO_ASSESSMENTS,
  });
}

test('listByCourse returns only that course’s assessments', () => {
  const list = service().listByCourse('kubernetes-foundations');
  assert.equal(list.length, 2);
  assert.ok(list.every((a) => a.courseSlug === 'kubernetes-foundations'));
  assert.deepEqual(service().listByCourse('nope'), []);
});

test('the graded assessment is proctored and its practice sibling is not', () => {
  const graded = service().getAssessment('k8s-quiz-1');
  const practice = service().getAssessment('k8s-practice-1');
  assert.equal(graded?.proctored, true);
  assert.equal(graded?.durationSeconds, 1800);
  assert.equal(practice?.proctored, false);
  assert.equal(practice?.durationSeconds, null);
});

test('the student view hides the answer key and hidden tests', () => {
  const view = service().getAssessment('k8s-quiz-1')!;
  const coding = view.questions.find((q) => q.kind === 'coding')!;
  // No `tests`/`correctIndex` field exists on the view at all.
  assert.equal((coding as unknown as Record<string, unknown>)['tests'], undefined);
  assert.equal(coding.hasSolutionRegion, true);
  const mcq = view.questions.find((q) => q.kind === 'mcq')!;
  assert.equal((mcq as unknown as Record<string, unknown>)['correctIndex'], undefined);
  assert.deepEqual(mcq.options, ['Pod', 'Service', 'Ingress', 'Namespace']);
});

test('startAttempt stamps a server deadline and is idempotent while open', async () => {
  const svc = service();
  const clock = stepClock('2026-11-11T09:00:00Z');
  const a1 = await svc.startAttempt('u1', 'k8s-quiz-1', clock);
  assert.ok(a1);
  assert.equal(a1.endsAt, '2026-11-11T09:30:00.000Z');
  assert.equal(a1.remainingSeconds, 1800);

  clock.advance(60);
  const again = await svc.startAttempt('u1', 'k8s-quiz-1', clock);
  // Same attempt, same deadline: refreshing does not restart the clock.
  assert.equal(again?.id, a1.id);
  assert.equal(again?.endsAt, '2026-11-11T09:30:00.000Z');
  assert.equal(again?.remainingSeconds, 1740);
});

test('an untimed practice assessment has no deadline', async () => {
  const attempt = await service().startAttempt('u1', 'k8s-practice-1');
  assert.equal(attempt?.endsAt, null);
  assert.equal(attempt?.remainingSeconds, null);
});

test('startAttempt on an unknown assessment is null', async () => {
  assert.equal(await service().startAttempt('u1', 'nope'), null);
});

test('getAttempt is scoped to its owner', async () => {
  const svc = service();
  const attempt = await svc.startAttempt('u1', 'k8s-quiz-1');
  assert.equal(await svc.getAttempt(attempt!.id, 'u2'), null);
  assert.equal((await svc.getAttempt(attempt!.id, 'u1'))?.id, attempt!.id);
});

test('submitting grades objective questions without a runner', async () => {
  const svc = service(null);
  const attempt = await svc.startAttempt('u1', 'k8s-quiz-1');
  const result = await svc.submit(attempt!.id, 'u1', {
    'q-pod': 0, // correct MCQ (20)
    'q-mean': 'def average(nums): return 0', // coding, no runner → 0
    'q-kubectl': 'apply', // correct fill (20)
  });
  assert.ok(!('reason' in result));
  if ('reason' in result) return;
  assert.equal(result.score, 40);
  assert.equal(result.maxScore, 100);
  assert.equal(result.status, 'submitted');
});

test('a coding question runs on the pool and enforces the read-only region', async () => {
  const { calls, provider } = fakeRunner({ '[1, 2, 3]': '2.0\n', '[4, 8]': '6.0\n' });
  const svc = service(provider);
  const attempt = await svc.startAttempt('u1', 'k8s-quiz-1');
  const stub = DEMO_ASSESSMENTS[0]!.questions.find((q) => q.id === 'q-mean')!.stubCode!;
  const answer = stub.replace('# Write your code here', 'return sum(nums) / len(nums)');
  const result = await svc.submit(attempt!.id, 'u1', { 'q-mean': answer });
  assert.ok(!('reason' in result));
  if ('reason' in result) return;
  // The coding question is worth 60; both hidden tests pass with the runner.
  const coding = result.results.find((r) => r.questionId === 'q-mean')!;
  assert.equal(coding.score, 60);
  assert.equal(calls.length, 2); // one run per hidden test case
  assert.equal(calls[0]!.runtime, 'python');
});

test('a tampered read-only region scores zero and never runs', async () => {
  const { calls, provider } = fakeRunner();
  const svc = service(provider);
  const attempt = await svc.startAttempt('u1', 'k8s-quiz-1');
  const tampered = 'def average(nums, extra):\n    # start your solution\n    pass\n    # end your solution\n';
  const result = await svc.submit(attempt!.id, 'u1', { 'q-mean': tampered });
  assert.ok(!('reason' in result));
  if ('reason' in result) return;
  const coding = result.results.find((r) => r.questionId === 'q-mean')!;
  assert.equal(coding.score, 0);
  assert.match(coding.feedback, /read-only region/i);
  assert.equal(calls.length, 0);
});

test('a submission past the deadline is recorded as expired with zero score', async () => {
  const svc = service(null);
  const clock = stepClock('2026-11-11T09:00:00Z');
  const attempt = await svc.startAttempt('u1', 'k8s-quiz-1', clock);
  clock.advance(1800 + 60); // 60s past the deadline, beyond the grace window
  const result = await svc.submit(attempt!.id, 'u1', { 'q-pod': 0 }, clock);
  assert.ok(!('reason' in result));
  if ('reason' in result) return;
  assert.equal(result.status, 'expired');
  assert.equal(result.score, 0);
});

test('submitting twice is rejected the second time', async () => {
  const svc = service(null);
  const attempt = await svc.startAttempt('u1', 'k8s-practice-1');
  await svc.submit(attempt!.id, 'u1', {});
  const again = await svc.submit(attempt!.id, 'u1', {});
  assert.deepEqual(again, { reason: 'already_submitted' });
});

test('submitting another user’s attempt is not found', async () => {
  const svc = service(null);
  const attempt = await svc.startAttempt('u1', 'k8s-practice-1');
  assert.deepEqual(await svc.submit(attempt!.id, 'u2', {}), { reason: 'not_found' });
});

test('history lists a student’s attempts, newest first', async () => {
  const svc = service(null);
  const clock = stepClock('2026-11-11T09:00:00Z');
  await svc.startAttempt('u1', 'k8s-practice-1', clock);
  clock.advance(5);
  await svc.startAttempt('u1', 'k8s-quiz-1', clock);
  const history = await svc.history('u1');
  assert.equal(history.length, 2);
  assert.equal(history[0]!.assessmentId, 'k8s-quiz-1');
});
