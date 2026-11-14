import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { hmacSha256Hex } from '@tenxlab/contracts';
import { PodProvider, RoutingProvider } from '@tenxlab/lab-provider';
import { JwtService } from './crypto/jwt.service';
import { PartnerSsoService } from './identity/partner-sso.service';
import { LabLaunchService } from './labs/lab-launch.service';
import { UsageService } from './labs/usage.service';
import { GradebookWebhookService } from './gradebook/gradebook-webhook.service';
import {
  InMemoryEventLedger,
  InMemoryLabSessionRepository,
  InMemoryLessonRepository,
  InMemoryMembershipRepository,
  InMemoryProgressRepository,
  InMemoryReplayGuard,
  InMemoryTenantRepository,
  InMemoryUserRepository,
} from './common/in-memory';

function makeKeys() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { privateKey, publicKey, kid: 'test-1' };
}

function makeJwt() {
  return new JwtService(makeKeys(), 7200);
}

// ------------------------------------------------------------------ JWT

test('launch JWT round-trips and verifies via public key', () => {
  const svc = makeJwt();
  const token = svc.issueLaunchToken({
    userId: 'user_1',
    tenantId: 'tenant_1',
    membershipRole: 'student',
    exerciseId: 'create-simple-pod',
    runtimeTier: 'tier_3_vcluster',
    sessionId: 'sess_1',
    callbackUrl: 'https://lms.example.com/hook',
  });
  const decoded = svc.verifyLaunchToken(token);
  assert.equal(decoded.sub, 'user_1');
  assert.equal(decoded.runtime_tier, 'tier_3_vcluster');
  assert.equal(decoded.iss, 'tenxlms');
  assert.equal(decoded.aud, 'kubelab');
});

test('launch JWT rejects tampering', () => {
  const svc = makeJwt();
  const token = svc.issueLaunchToken({
    userId: 'u',
    tenantId: 't',
    membershipRole: 'student',
    exerciseId: 'e',
    runtimeTier: 'tier_1_microvm',
    sessionId: 's',
    callbackUrl: 'https://lms.example.com/hook',
  });
  const parts = token.split('.');
  const tampered = `${parts[0]}.${parts[1]}.${(parts[2] ?? '').slice(0, -2)}xx`;
  assert.throws(() => svc.verifyLaunchToken(tampered));
});

test('JWKS exposes the RSA public key as a JWK', () => {
  const svc = makeJwt();
  const jwks = svc.jwks();
  assert.equal(jwks.keys.length, 1);
  const key = jwks.keys[0] as Record<string, unknown>;
  assert.equal(key.kty, 'RSA');
  assert.equal(key.alg, 'RS256');
  assert.equal(key.kid, 'test-1');
  assert.equal(typeof key.n, 'string');
  assert.equal(key.e, 'AQAB'); // 65537 in base64url
});

// -------------------------------------------------------------- Partner SSO

function ssoFixture() {
  const tenants = new InMemoryTenantRepository();
  tenants.seed({
    id: 'tenant_1',
    name: 'Acme College',
    domain: 'acme-college',
    maxConcurrentLabs: 10,
    monthlyBudgetCents: 0,
    plan: 'standard',
    status: 'active',
  });
  const users = new InMemoryUserRepository();
  const memberships = new InMemoryMembershipRepository();
  const replay = new InMemoryReplayGuard();
  const svc = new PartnerSsoService(tenants, users, memberships, replay, {
    secrets: { 'acme-college': 'partner-secret' },
    jitProvisioning: true,
  });
  return { svc, users, memberships, tenants };
}

function mintPartnerToken(
  secret: string,
  claims: Record<string, unknown>,
  opts: jwt.SignOptions = {},
) {
  return jwt.sign(claims, secret, { algorithm: 'HS256', ...opts });
}

test('partner SSO accepts a valid token and provisions the user', async () => {
  const { svc } = ssoFixture();
  const now = Math.floor(Date.now() / 1000);
  const token = mintPartnerToken('partner-secret', {
    sub: 'student@acme.edu',
    partnerId: 'acme-college',
    name: 'Student One',
    iat: now,
    exp: now + 60,
    jti: 'jti-1',
  });
  const res = await svc.verify(token);
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.role, 'student');
    assert.equal(res.tenantId, 'tenant_1');
  }
});

test('partner SSO rejects a bad signature', async () => {
  const { svc } = ssoFixture();
  const now = Math.floor(Date.now() / 1000);
  const token = mintPartnerToken('wrong-secret', {
    sub: 'student@acme.edu',
    partnerId: 'acme-college',
    iat: now,
    exp: now + 60,
    jti: 'jti-2',
  });
  const res = await svc.verify(token);
  assert.deepEqual(res, { ok: false, reason: 'invalid_signature' });
});

test('partner SSO rejects an unknown partner', async () => {
  const { svc } = ssoFixture();
  const now = Math.floor(Date.now() / 1000);
  const token = mintPartnerToken('partner-secret', {
    sub: 'student@acme.edu',
    partnerId: 'nope-college',
    iat: now,
    exp: now + 60,
    jti: 'jti-3',
  });
  const res = await svc.verify(token);
  assert.deepEqual(res, { ok: false, reason: 'unknown_partner' });
});

test('partner SSO rejects a replayed token', async () => {
  const { svc } = ssoFixture();
  const now = Math.floor(Date.now() / 1000);
  const token = mintPartnerToken('partner-secret', {
    sub: 'student@acme.edu',
    partnerId: 'acme-college',
    iat: now,
    exp: now + 60,
    jti: 'jti-replay',
  });
  const first = await svc.verify(token);
  assert.equal(first.ok, true);
  const second = await svc.verify(token);
  assert.deepEqual(second, { ok: false, reason: 'replay_detected' });
});

test('partner SSO rejects an expired token', async () => {
  const { svc } = ssoFixture();
  const past = Math.floor(Date.now() / 1000) - 600;
  const token = mintPartnerToken('partner-secret', {
    sub: 'student@acme.edu',
    partnerId: 'acme-college',
    iat: past,
    exp: past + 60,
    jti: 'jti-exp',
  });
  const res = await svc.verify(token);
  assert.deepEqual(res, { ok: false, reason: 'token_expired' });
});

test('partner SSO rejects unknown user when JIT is disabled', async () => {
  const tenants = new InMemoryTenantRepository();
  tenants.seed({
    id: 'tenant_1',
    name: 'Acme',
    domain: 'acme-college',
    maxConcurrentLabs: 10,
    monthlyBudgetCents: 0,
    plan: 'standard',
    status: 'active',
  });
  const svc = new PartnerSsoService(
    tenants,
    new InMemoryUserRepository(),
    new InMemoryMembershipRepository(),
    new InMemoryReplayGuard(),
    { secrets: { 'acme-college': 'partner-secret' }, jitProvisioning: false },
  );
  const now = Math.floor(Date.now() / 1000);
  const token = mintPartnerToken('partner-secret', {
    sub: 'nobody@acme.edu',
    partnerId: 'acme-college',
    iat: now,
    exp: now + 60,
    jti: 'jti-nouser',
  });
  const res = await svc.verify(token);
  assert.deepEqual(res, { ok: false, reason: 'user_not_found' });
});

// -------------------------------------------------------------- Lab launch

function labFixture(maxConcurrentLabs = 10) {
  const tenants = new InMemoryTenantRepository();
  tenants.seed({
    id: 'tenant_1',
    name: 'Acme',
    domain: 'acme-college',
    maxConcurrentLabs,
    monthlyBudgetCents: 0,
    plan: 'standard',
    status: 'active',
  });
  const memberships = new InMemoryMembershipRepository();
  memberships.seed({
    id: 'm1',
    userId: 'user_1',
    tenantId: 'tenant_1',
    role: 'student',
    status: 'active',
  });
  const lessons = new InMemoryLessonRepository();
  lessons.seed({
    id: 'lesson_1',
    moduleId: 'mod_1',
    title: 'Create a Pod',
    type: 'interactive_lab',
    exerciseSlug: 'create-simple-pod',
    runtimeTier: 'tier_3_vcluster',
    maxScore: 100,
  });
  lessons.seed({
    id: 'lesson_video',
    moduleId: 'mod_1',
    title: 'Intro video',
    type: 'video',
    maxScore: 0,
  });
  const sessions = new InMemoryLabSessionRepository();
  const svc = new LabLaunchService({
    lessons,
    memberships,
    tenants,
    sessions,
    provider: null,
  });
  return { svc, sessions, memberships };
}

test('lab launch creates a session and routes it to the vcluster tier', async () => {
  const { svc, sessions } = labFixture();
  const res = await svc.launch({
    userId: 'user_1',
    tenantId: 'tenant_1',
    lessonId: 'lesson_1',
  });
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.tier, 'tier_3_vcluster');
    assert.equal(res.status, 'WARM');
    const row = await sessions.findById(res.sessionId);
    assert.equal(row?.exerciseSlug, 'create-simple-pod');
    assert.equal(row?.userId, 'user_1');
  }
});

test('lab launch provisions through the provider and records the IDE URL', async () => {
  const { sessions } = labFixture();
  const provisioned: Array<Record<string, unknown>> = [];
  const provider = {
    name: 'fake',
    async provision(spec: Record<string, unknown>) {
      provisioned.push(spec);
      return {
        session_id: String(spec['session_id']),
        status: 'ACTIVE' as const,
        tier: 'tier_3_vcluster' as const,
        ide_url: 'https://ide.example.com/session',
        provider_ref: 'kl-1',
        started_at: new Date().toISOString(),
        last_activity_at: new Date().toISOString(),
        ttl_seconds: 1800,
      };
    },
  };
  const svc = new LabLaunchService({
    lessons: new InMemoryLessonRepository([
      {
        id: 'lesson_1',
        moduleId: 'mod_1',
        title: 'Create a Pod',
        type: 'interactive_lab',
        exerciseSlug: 'create-simple-pod',
        runtimeTier: 'tier_3_vcluster',
        maxScore: 100,
      },
    ]),
    memberships: new InMemoryMembershipRepository([
      { id: 'm1', userId: 'user_1', tenantId: 'tenant_1', role: 'student', status: 'active' },
    ]),
    tenants: new InMemoryTenantRepository([
      {
        id: 'tenant_1',
        name: 'Acme',
        domain: 'acme',
        maxConcurrentLabs: 10,
        monthlyBudgetCents: 0,
        plan: 'standard',
        status: 'active',
      },
    ]),
    sessions,
    provider: provider as never,
  });

  const res = await svc.launch({ userId: 'user_1', tenantId: 'tenant_1', lessonId: 'lesson_1' });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  // Provisioning runs in the background; wait for the session to settle.
  await waitFor(async () => (await sessions.findById(res.sessionId))?.status === 'ACTIVE');
  const row = await sessions.findById(res.sessionId);
  assert.equal(row?.status, 'ACTIVE');
  assert.equal(row?.ideUrl, 'https://ide.example.com/session');
  assert.equal(row?.kubelabRef, 'kl-1');
  assert.equal(provisioned.length, 1);
  assert.equal(provisioned[0]?.['exercise_id'], 'create-simple-pod');
});

test('a tier-2 lesson routes to the pod provider and records its IDE URL', async () => {
  const { sessions } = labFixture();
  const applied: Array<Record<string, unknown>> = [];
  const cluster = {
    async apply(manifest: Record<string, unknown>) {
      applied.push(manifest);
    },
    async delete() {},
    async get() {
      return null;
    },
    async list() {
      return [];
    },
  };
  const provider = new RoutingProvider({
    tier_2_container: new PodProvider({
      cluster,
      allowedHosts: '192.168.49.2.nip.io',
      fetchImpl: (async () => ({ status: 200 })) as unknown as typeof fetch,
    }),
  });
  const svc = new LabLaunchService({
    lessons: new InMemoryLessonRepository([
      {
        id: 'lesson_2',
        moduleId: 'mod_1',
        title: 'Build a web app',
        type: 'interactive_lab',
        exerciseSlug: 'build-a-web-app',
        runtimeTier: 'tier_2_container',
        maxScore: 100,
      },
    ]),
    memberships: new InMemoryMembershipRepository([
      { id: 'm1', userId: 'user_1', tenantId: 'tenant_1', role: 'student', status: 'active' },
    ]),
    tenants: new InMemoryTenantRepository([
      {
        id: 'tenant_1',
        name: 'Acme',
        domain: 'acme',
        maxConcurrentLabs: 10,
        monthlyBudgetCents: 0,
        plan: 'standard',
        status: 'active',
      },
    ]),
    sessions,
    provider,
  });

  const res = await svc.launch({ userId: 'user_1', tenantId: 'tenant_1', lessonId: 'lesson_2' });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  assert.equal(res.tier, 'tier_2_container');
  await waitFor(async () => (await sessions.findById(res.sessionId))?.status === 'ACTIVE');
  const row = await sessions.findById(res.sessionId);
  assert.equal(row?.status, 'ACTIVE');
  assert.match(row?.ideUrl ?? '', /^https:\/\/tenxlab-t2-.*\.192\.168\.49\.2\.nip\.io\/$/);
  assert.equal(row?.kubelabRef, `tenxlab-t2-${res.sessionId}`);
  // The pod provider created the session's namespace and pod.
  assert.deepEqual(
    applied.map((m) => m['kind']),
    ['Namespace', 'PersistentVolumeClaim', 'Pod', 'Service', 'Ingress'],
  );
});

test('lab launch records FAILED when provisioning throws', async () => {
  const { sessions } = labFixture();
  const svc = new LabLaunchService({
    lessons: new InMemoryLessonRepository([
      {
        id: 'lesson_1',
        moduleId: 'mod_1',
        title: 'Create a Pod',
        type: 'interactive_lab',
        exerciseSlug: 'create-simple-pod',
        runtimeTier: 'tier_3_vcluster',
        maxScore: 100,
      },
    ]),
    memberships: new InMemoryMembershipRepository([
      { id: 'm1', userId: 'user_1', tenantId: 'tenant_1', role: 'student', status: 'active' },
    ]),
    tenants: new InMemoryTenantRepository([
      {
        id: 'tenant_1',
        name: 'Acme',
        domain: 'acme',
        maxConcurrentLabs: 10,
        monthlyBudgetCents: 0,
        plan: 'standard',
        status: 'active',
      },
    ]),
    sessions,
    provider: {
      name: 'boom',
      async provision() {
        throw new Error('cluster exploded');
      },
    } as never,
  });

  const res = await svc.launch({ userId: 'user_1', tenantId: 'tenant_1', lessonId: 'lesson_1' });
  assert.equal(res.ok, true);
  if (!res.ok) return;
  await waitFor(async () => (await sessions.findById(res.sessionId))?.status === 'FAILED');
  assert.equal((await sessions.findById(res.sessionId))?.status, 'FAILED');
});

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('waitFor timed out');
}

test('lab launch rejects a non-lab lesson', async () => {
  const { svc } = labFixture();
  const res = await svc.launch({
    userId: 'user_1',
    tenantId: 'tenant_1',
    lessonId: 'lesson_video',
  });
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.reason, 'not_a_lab');
});

test('lab launch enforces the tenant concurrency quota', async () => {
  const { svc } = labFixture(1);
  const first = await svc.launch({
    userId: 'user_1',
    tenantId: 'tenant_1',
    lessonId: 'lesson_1',
  });
  assert.equal(first.ok, true);
  const second = await svc.launch({
    userId: 'user_1',
    tenantId: 'tenant_1',
    lessonId: 'lesson_1',
  });
  assert.equal(second.ok, false);
  if (!second.ok) assert.equal(second.reason, 'tenant_quota_exceeded');
});

test('lab launch blocks a tenant over its monthly budget', async () => {
  const tenants = new InMemoryTenantRepository([
    {
      id: 'tenant_1',
      name: 'Acme',
      domain: 'acme-college',
      maxConcurrentLabs: 10,
      monthlyBudgetCents: 1,
      plan: 'standard',
      status: 'active',
    },
  ]);
  const sessions = new InMemoryLabSessionRepository();
  const svc = new LabLaunchService({
    lessons: new InMemoryLessonRepository([
      {
        id: 'lesson_1',
        moduleId: 'mod_1',
        title: 'Create a Pod',
        type: 'interactive_lab',
        exerciseSlug: 'create-simple-pod',
        runtimeTier: 'tier_3_vcluster',
        maxScore: 100,
      },
    ]),
    memberships: new InMemoryMembershipRepository([
      { id: 'm1', userId: 'user_1', tenantId: 'tenant_1', role: 'student', status: 'active' },
    ]),
    tenants,
    sessions,
    provider: null,
    usage: new UsageService({ tenants, sessions }),
  });
  // A single past session already exceeds the 1-cent ceiling.
  await sessions.create({
    tenantId: 'tenant_1',
    userId: 'user_1',
    exerciseSlug: 'create-simple-pod',
    tier: 'tier_3_vcluster',
    status: 'TERMINATED',
    startedAt: new Date(),
    lastActivityAt: new Date(Date.now() + 60_000),
    ttlSeconds: 1800,
  });

  const res = await svc.launch({
    userId: 'user_1',
    tenantId: 'tenant_1',
    lessonId: 'lesson_1',
  });
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.reason, 'tenant_quota_exceeded');
});

test('lab launch requires an active membership', async () => {
  const { svc, memberships } = labFixture();
  const res = await svc.launch({
    userId: 'stranger',
    tenantId: 'tenant_1',
    lessonId: 'lesson_1',
  });
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.reason, 'membership_required');
  assert.equal(await memberships.find('stranger', 'tenant_1'), null);
});

// ----------------------------------------------------------- Gradebook webhook

function gradebookFixture() {
  const sessions = new InMemoryLabSessionRepository();
  const progress = new InMemoryProgressRepository();
  const svc = new GradebookWebhookService({
    webhookSecret: 'hook-secret',
    ledger: new InMemoryEventLedger(),
    sessions,
    progress,
    resolveLessonId: async (slug, tenantId) =>
      slug === 'create-simple-pod' && tenantId === 'tenant_1' ? 'lesson_1' : null,
  });
  return { svc, progress };
}

function webhookBody(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    event: 'exercise.completed',
    event_id: 'evt_1',
    student_id: 'user_1',
    tenant_id: 'tenant_1',
    exercise_id: 'create-simple-pod',
    session_id: 'sess_1',
    status: 'PASSED',
    score: 100,
    execution_time_ms: 1420,
    attempt_count: 2,
    timestamp: '2026-11-11T09:00:00Z',
    ...overrides,
  });
}

test('gradebook webhook records progress on a valid signature', async () => {
  const { svc, progress } = gradebookFixture();
  const body = webhookBody();
  const sig = hmacSha256Hex('hook-secret', body);
  const res = await svc.handle(body, sig);
  assert.deepEqual(res, { ok: true, duplicate: false, lessonId: 'lesson_1' });
  const row = await progress.findByUserAndLesson('user_1', 'lesson_1');
  assert.equal(row?.status, 'complete');
  assert.equal(row?.score, 100);
});

test('gradebook webhook rejects an invalid signature with 401', async () => {
  const { svc } = gradebookFixture();
  const body = webhookBody();
  const res = await svc.handle(body, 'deadbeef');
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.status, 401);
});

test('gradebook webhook is idempotent on duplicate event ids', async () => {
  const { svc } = gradebookFixture();
  const body = webhookBody();
  const sig = hmacSha256Hex('hook-secret', body);
  const first = await svc.handle(body, sig);
  const second = await svc.handle(body, sig);
  assert.equal(first.ok, true);
  assert.deepEqual(second, { ok: true, duplicate: true });
});

test('gradebook webhook rejects an unknown exercise with 422', async () => {
  const { svc } = gradebookFixture();
  const body = webhookBody({ exercise_id: 'unknown-exercise' });
  const sig = hmacSha256Hex('hook-secret', body);
  const res = await svc.handle(body, sig);
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.status, 422);
});

test('gradebook webhook rejects a malformed payload with 422', async () => {
  const { svc } = gradebookFixture();
  const body = JSON.stringify({ event: 'exercise.completed' });
  const sig = hmacSha256Hex('hook-secret', body);
  const res = await svc.handle(body, sig);
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.status, 422);
});
