import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ssoErrorMessage,
  labLaunchState,
  lessonStatusLabel,
  courseProgress,
  proxyFetchInit,
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
