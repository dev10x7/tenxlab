import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ssoErrorMessage,
  labLaunchState,
  lessonStatusLabel,
  courseProgress,
  proxyFetchInit,
  gradebookRowSummary,
  gradebookCellLabel,
  snippetTitle,
  runStatusLabel,
  runHasOutput,
  formatClock,
  clockUrgent,
  riskLevelLabel,
  riskSummaryLabel,
  attemptClockLabel,
} from '../src/lib/lms.ts';

test('ssoErrorMessage maps every known reason', () => {
  assert.match(ssoErrorMessage('invalid_signature'), /invalid/i);
  assert.match(ssoErrorMessage('token_expired'), /expired/i);
  assert.match(ssoErrorMessage('replay_detected'), /already used/i);
  assert.match(ssoErrorMessage('unknown_partner'), /not registered/i);
  assert.match(ssoErrorMessage('user_not_found'), /could not find/i);
});

test('ssoErrorMessage returns null for unknown or absent reasons', () => {
  assert.equal(ssoErrorMessage(undefined), null);
  assert.equal(ssoErrorMessage('something_else'), null);
});

test('labLaunchState reports readiness, pending, and failure', () => {
  assert.deepEqual(labLaunchState({ status: 'WARM' }), {
    ready: false,
    failed: false,
    ideUrl: null,
  });
  assert.deepEqual(labLaunchState({ status: 'ACTIVE', ideUrl: 'https://ide' }), {
    ready: true,
    failed: false,
    ideUrl: 'https://ide',
  });
  // ACTIVE without a URL is not yet usable.
  assert.equal(labLaunchState({ status: 'ACTIVE', ideUrl: null }).ready, false);
  assert.equal(labLaunchState({ status: 'FAILED' }).failed, true);
});

test('lessonStatusLabel reflects progress and score', () => {
  assert.equal(lessonStatusLabel('not_started', null), 'Not started');
  assert.equal(lessonStatusLabel('in_progress', null), 'In progress');
  assert.equal(lessonStatusLabel('complete', null), 'Completed');
  assert.equal(lessonStatusLabel('complete', 92), 'Completed — 92%');
});

test('courseProgress computes a clamped percentage', () => {
  assert.equal(courseProgress([]), 0);
  assert.equal(courseProgress([{ status: 'complete' }, { status: 'not_started' }]), 50);
  assert.equal(
    courseProgress([{ status: 'complete' }, { status: 'complete' }]),
    100,
  );
});

test('proxyFetchInit disables caching so session polls see fresh status', () => {
  const init = proxyFetchInit({
    method: 'GET',
    headers: new Headers({ cookie: 'a=b' }),
  });
  assert.equal(init.cache, 'no-store');
  assert.equal(init.redirect, 'manual');
});

test('gradebookRowSummary reports progress and average', () => {
  assert.equal(
    gradebookRowSummary({ completed: 1, total: 2, averageScore: 90 }),
    '1/2 lessons · avg 90%',
  );
  assert.equal(
    gradebookRowSummary({ completed: 0, total: 2, averageScore: null }),
    '0/2 lessons · not graded',
  );
});

test('gradebookCellLabel prefers the score, then the status', () => {
  assert.equal(gradebookCellLabel({ status: 'complete', score: 88 }), '88%');
  assert.equal(gradebookCellLabel({ status: 'complete', score: null }), 'Done');
  assert.equal(gradebookCellLabel({ status: 'in_progress', score: null }), 'In progress');
  assert.equal(gradebookCellLabel({ status: 'not_started', score: null }), '—');
});

test('snippetTitle falls back for blank titles', () => {
  assert.equal(snippetTitle('  Two Sum  '), 'Two Sum');
  assert.equal(snippetTitle(''), 'Untitled');
  assert.equal(snippetTitle('   '), 'Untitled');
  assert.equal(snippetTitle(null), 'Untitled');
  assert.equal(snippetTitle(undefined), 'Untitled');
});

test('runStatusLabel distinguishes each run outcome', () => {
  assert.equal(
    runStatusLabel({ exitCode: 0, timedOut: false, unsupported: false, executionTimeMs: 42 }),
    'Finished in 42 ms',
  );
  assert.equal(
    runStatusLabel({ exitCode: 1, timedOut: false, unsupported: false, executionTimeMs: 5 }),
    'Exited with code 1',
  );
  assert.equal(
    runStatusLabel({ exitCode: null, timedOut: true, unsupported: false, executionTimeMs: 5000 }),
    'Timed out',
  );
  assert.equal(
    runStatusLabel({ exitCode: null, timedOut: false, unsupported: true, executionTimeMs: 0 }),
    'Runtime unavailable',
  );
  assert.equal(
    runStatusLabel({ exitCode: null, timedOut: false, unsupported: false, executionTimeMs: 0 }),
    'Stopped',
  );
});

test('runHasOutput is true when either stream has content', () => {
  assert.equal(runHasOutput({ stdout: 'hi', stderr: '' }), true);
  assert.equal(runHasOutput({ stdout: '', stderr: 'boom' }), true);
  assert.equal(runHasOutput({ stdout: '', stderr: '' }), false);
});

test('formatClock renders m:ss and h:mm:ss, clamping negatives', () => {
  assert.equal(formatClock(0), '0:00');
  assert.equal(formatClock(9), '0:09');
  assert.equal(formatClock(90), '1:30');
  assert.equal(formatClock(1800), '30:00');
  assert.equal(formatClock(3661), '1:01:01');
  assert.equal(formatClock(-5), '0:00');
});

test('clockUrgent fires only in the last two minutes', () => {
  assert.equal(clockUrgent(121), false);
  assert.equal(clockUrgent(120), true);
  assert.equal(clockUrgent(0), true);
});

test('riskLevelLabel maps each band', () => {
  assert.equal(riskLevelLabel('low'), 'Low risk');
  assert.equal(riskLevelLabel('medium'), 'Review');
  assert.equal(riskLevelLabel('high'), 'High risk');
});

test('riskSummaryLabel pluralizes the signal count', () => {
  assert.equal(
    riskSummaryLabel({ eventCount: 1, riskScore: 8, riskLevel: 'low' }),
    'Low risk · 1 signal · score 8',
  );
  assert.equal(
    riskSummaryLabel({ eventCount: 3, riskScore: 25, riskLevel: 'medium' }),
    'Review · 3 signals · score 25',
  );
});

test('attemptClockLabel shows Untimed when there is no deadline', () => {
  assert.equal(attemptClockLabel(null), 'Untimed');
  assert.equal(attemptClockLabel(90), '1:30');
});
