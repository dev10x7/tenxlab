import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  gradeMcq,
  gradeFill,
  gradeDescriptive,
  gradeCoding,
  gradeAttempt,
  type Question,
  type CodeRunner,
} from './assessments/grader';
import { buildManifest, checkReadOnly, sha256 } from './assessments/read-only';
import {
  summarizeEvents,
  buildSebConfig,
  REVIEW_THRESHOLD,
  type ProctorEvent,
} from './proctoring/proctoring.service';

// ------------------------------------------------------------------ grading

test('MCQ grades a correct single choice', () => {
  const r = gradeMcq(
    { type: 'mcq', id: 'q1', maxScore: 5, correctIndex: 2 },
    2,
  );
  assert.equal(r.score, 5);
  assert.equal(r.correct, true);
});

test('MCQ grades a wrong single choice as zero', () => {
  const r = gradeMcq({ type: 'mcq', id: 'q1', maxScore: 5, correctIndex: 2 }, 0);
  assert.equal(r.score, 0);
  assert.equal(r.correct, false);
});

test('MCQ multi-select requires the exact set', () => {
  const q = { type: 'mcq' as const, id: 'q1', maxScore: 6, correctIndex: 1, multiple: true };
  assert.equal(gradeMcq(q, [1]).score, 6);
  assert.equal(gradeMcq(q, [1, 3]).score, 0);
});

test('fill answers are case- and whitespace-insensitive', () => {
  const q = { type: 'fill' as const, id: 'q1', maxScore: 4, accepted: ['Kubernetes'] };
  assert.equal(gradeFill(q, '  kubernetes ').score, 4);
  assert.equal(gradeFill(q, 'docker').score, 0);
});

test('descriptive scoring is proportional to rubric coverage', () => {
  const q = {
    type: 'descriptive' as const,
    id: 'q1',
    maxScore: 10,
    rubricKeywords: ['pod', 'container', 'node'],
  };
  assert.equal(gradeDescriptive(q, 'A pod runs a container').score, 7); // 2/3
  assert.equal(gradeDescriptive(q, 'pod container node').score, 10);
  assert.equal(gradeDescriptive(q, 'nothing relevant').score, 0);
});

test('descriptive flags correctness below the pass fraction', () => {
  const q = {
    type: 'descriptive' as const,
    id: 'q1',
    maxScore: 10,
    rubricKeywords: ['a', 'b', 'c', 'd'],
  };
  const r = gradeDescriptive(q, 'a b'); // 50% < 60% default
  assert.equal(r.correct, false);
  assert.match(r.feedback, /missing rubric points/i);
});

test('coding grading runs the injected runner against each test case', async () => {
  const runner: CodeRunner = {
    async run(code, input) {
      // Echo-style runner: the "program" is `echo:<n>` and output is code+input.
      return `${code}${input}`;
    },
  };
  const q = {
    type: 'coding' as const,
    id: 'q1',
    maxScore: 10,
    tests: [
      { input: '1', expected: 'X1' },
      { input: '2', expected: 'X2' },
    ],
  };
  const r = await gradeCoding(q, 'X', runner);
  assert.equal(r.score, 10);
  assert.equal(r.correct, true);
});

test('coding grading tolerates trailing whitespace and CRLF', async () => {
  const runner: CodeRunner = { async run() { return 'ok\r\n'; } };
  const q = {
    type: 'coding' as const,
    id: 'q1',
    maxScore: 3,
    tests: [{ input: '', expected: 'ok' }],
  };
  assert.equal((await gradeCoding(q, 'x', runner)).score, 3);
});

test('coding grading counts a runner error as a failed case', async () => {
  const runner: CodeRunner = {
    async run() {
      throw new Error('sandbox crashed');
    },
  };
  const q = {
    type: 'coding' as const,
    id: 'q1',
    maxScore: 10,
    tests: [{ input: '', expected: 'ok' }],
  };
  const r = await gradeCoding(q, 'x', runner);
  assert.equal(r.score, 0);
  assert.match(r.feedback, /0\/1/);
});

test('gradeAttempt totals scores across mixed question types', async () => {
  const questions: Question[] = [
    { type: 'mcq', id: 'q1', maxScore: 5, correctIndex: 0 },
    { type: 'fill', id: 'q2', maxScore: 5, accepted: ['yes'] },
  ];
  const runner: CodeRunner = { async run() { return ''; } };
  const { total, maxTotal, results } = await gradeAttempt(
    questions,
    { q1: 0, q2: 'yes' },
    runner,
  );
  assert.equal(total, 10);
  assert.equal(maxTotal, 10);
  assert.equal(results.q1?.correct, true);
  assert.equal(results.q2?.correct, true);
});

// --------------------------------------------------------------- read-only

test('sha256 is stable and content-sensitive', () => {
  assert.equal(sha256('abc'), sha256('abc'));
  assert.notEqual(sha256('abc'), sha256('abd'));
});

test('checkReadOnly passes when marker files are untouched', () => {
  const manifest = buildManifest([{ path: 'tests/run.sh', content: 'echo hi' }]);
  const violations = checkReadOnly(manifest, [
    { path: 'tests/run.sh', content: 'echo hi' },
    { path: 'solution.py', content: 'print(1)' },
  ]);
  assert.deepEqual(violations, []);
});

test('checkReadOnly detects a modified marker file', () => {
  const manifest = buildManifest([{ path: 'tests/run.sh', content: 'echo hi' }]);
  const violations = checkReadOnly(manifest, [
    { path: 'tests/run.sh', content: 'echo tampered' },
  ]);
  assert.deepEqual(violations, [{ path: 'tests/run.sh', reason: 'modified' }]);
});

test('checkReadOnly detects a deleted marker file', () => {
  const manifest = buildManifest([{ path: 'tests/run.sh', content: 'echo hi' }]);
  const violations = checkReadOnly(manifest, []);
  assert.deepEqual(violations, [{ path: 'tests/run.sh', reason: 'deleted' }]);
});

// -------------------------------------------------------------- proctoring

test('proctor summary aggregates counts and weights per attempt', () => {
  const events: ProctorEvent[] = [
    { attemptId: 'a1', type: 'focus_lost', at: 't1' },
    { attemptId: 'a1', type: 'focus_lost', at: 't2' },
    { attemptId: 'a1', type: 'copy', at: 't3' },
    { attemptId: 'a2', type: 'vm_detected', at: 't4' }, // different attempt
  ];
  const summary = summarizeEvents('a1', events);
  assert.equal(summary.eventCount, 3);
  assert.equal(summary.riskScore, 5 + 5 + 8);
  assert.equal(summary.riskLevel, 'medium');
  assert.equal(summary.counts.focus_lost, 2);
});

test('proctor risk crosses into high at the review threshold', () => {
  const events: ProctorEvent[] = [
    { attemptId: 'a1', type: 'vm_detected', at: 't1' },
  ];
  const summary = summarizeEvents('a1', events);
  assert.equal(summary.riskScore, REVIEW_THRESHOLD);
  assert.equal(summary.riskLevel, 'high');
});

test('proctor summary for an attempt with no events is low risk', () => {
  const summary = summarizeEvents('missing', []);
  assert.equal(summary.eventCount, 0);
  assert.equal(summary.riskLevel, 'low');
});

test('SEB config locks the browser down by default', () => {
  const config = buildSebConfig({ startUrl: 'https://lms.example.com/exam/1' });
  assert.equal(config.startURL, 'https://lms.example.com/exam/1');
  assert.equal(config.allowSwitchToApplications, false);
  assert.equal(config.enableAltTab, false);
  assert.equal(config.enableScreenCapture, false);
  assert.equal(config.sendBrowserExamKey, true);
});

test('SEB config honours overrides', () => {
  const config = buildSebConfig({
    startUrl: 'https://lms.example.com/exam/2',
    browserExamKey: 'KEY123',
    allowSwitchApps: true,
    showClock: false,
  });
  assert.equal(config.browserExamKey, 'KEY123');
  assert.equal(config.allowSwitchToApplications, true);
  assert.equal(config.showTimeClock, false);
});
