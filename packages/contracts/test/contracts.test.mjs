import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LabLaunchJwtPayload,
  CompletionWebhook,
  PartnerSsoClaims,
  LabSpec,
  hmacSha256Hex,
  verifyHmacSha256,
} from '../dist/index.js';

test('LabLaunchJwtPayload accepts a valid payload', () => {
  const payload = {
    iss: 'tenxlms',
    sub: 'user_1',
    aud: 'kubelab',
    tenant_id: 'college_abc',
    membership_role: 'student',
    batch_id: '2027_cse_a',
    course_id: 'k8s-101',
    exercise_id: 'create-simple-pod',
    runtime_tier: 'tier_3_vcluster',
    session_id: 'sess_1',
    callback_url: 'https://lms.tenxlab.app/api/webhooks/lab',
    iat: 1794384000,
    exp: 1794391200,
    jti: 'uuid-1',
  };
  assert.equal(LabLaunchJwtPayload.safeParse(payload).success, true);
});

test('LabLaunchJwtPayload rejects an unknown runtime tier', () => {
  const bad = {
    iss: 'tenxlms',
    sub: 'user_1',
    tenant_id: 't',
    membership_role: 'student',
    exercise_id: 'e',
    runtime_tier: 'tier_9_quantum',
    session_id: 's',
    callback_url: 'https://lms.tenxlab.app/hook',
    iat: 1,
    exp: 2,
    jti: 'j',
  };
  assert.equal(LabLaunchJwtPayload.safeParse(bad).success, false);
});

test('CompletionWebhook enforces score bounds', () => {
  const base = {
    event: 'exercise.completed',
    event_id: 'evt_1',
    student_id: 'user_1',
    tenant_id: 'college_abc',
    exercise_id: 'create-simple-pod',
    session_id: 'sess_1',
    status: 'PASSED',
    score: 100,
    execution_time_ms: 1420,
    attempt_count: 2,
    timestamp: '2026-11-11T09:00:00Z',
  };
  assert.equal(CompletionWebhook.safeParse(base).success, true);
  assert.equal(
    CompletionWebhook.safeParse({ ...base, score: 101 }).success,
    false,
  );
  assert.equal(
    CompletionWebhook.safeParse({ ...base, status: 'MAYBE' }).success,
    false,
  );
});

test('PartnerSsoClaims requires an email subject', () => {
  const ok = {
    sub: 'student@college.edu',
    partnerId: 'acme-college',
    iat: 1,
    exp: 61,
    jti: 'uuid',
  };
  assert.equal(PartnerSsoClaims.safeParse(ok).success, true);
  assert.equal(
    PartnerSsoClaims.safeParse({ ...ok, sub: 'not-an-email' }).success,
    false,
  );
});

test('LabSpec applies defaults for ttl and network policy', () => {
  const parsed = LabSpec.parse({
    exercise_id: 'e',
    runtime_tier: 'tier_1_microvm',
    tenant_id: 't',
    user_id: 'u',
    session_id: 's',
  });
  assert.equal(parsed.ttl_seconds, 1800);
  assert.equal(parsed.network_policy, 'allowlist');
});

test('hmacSha256Hex is deterministic and verifiable', () => {
  const secret = 'shared-secret';
  const body = JSON.stringify({ hello: 'world' });
  const sig = hmacSha256Hex(secret, body);
  assert.equal(sig, hmacSha256Hex(secret, body));
  assert.equal(verifyHmacSha256(secret, body, sig), true);
  assert.equal(verifyHmacSha256(secret, body, 'deadbeef'), false);
  assert.equal(verifyHmacSha256(secret, body, undefined), false);
  assert.equal(verifyHmacSha256('wrong-secret', body, sig), false);
});

test('verifyHmacSha256 rejects tampered bodies', () => {
  const secret = 's';
  const sig = hmacSha256Hex(secret, '{"a":1}');
  assert.equal(verifyHmacSha256(secret, '{"a":2}', sig), false);
});
