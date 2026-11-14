import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UsageService } from './usage.service';
import {
  InMemoryLabSessionRepository,
  InMemoryTenantRepository,
} from '../common/in-memory';
import type { LabSessionRecord, TenantRecord } from '../common/ports';

const NOW = new Date('2026-03-15T12:00:00Z');

function tenant(overrides: Partial<TenantRecord> = {}): TenantRecord {
  return {
    id: 't1',
    name: 'Acme',
    domain: 'acme',
    maxConcurrentLabs: 10,
    monthlyBudgetCents: 0,
    plan: 'standard',
    status: 'active',
    ...overrides,
  };
}

function session(overrides: Partial<LabSessionRecord> = {}): LabSessionRecord {
  return {
    id: 's1',
    tenantId: 't1',
    userId: 'u1',
    exerciseSlug: 'java-basics',
    tier: 'tier_2_container',
    status: 'TERMINATED',
    startedAt: new Date('2026-03-15T10:00:00Z'),
    lastActivityAt: new Date('2026-03-15T10:30:00Z'),
    ttlSeconds: 1800,
    ...overrides,
  };
}

async function fixture(
  tenants: TenantRecord[],
  sessions: LabSessionRecord[],
  now = NOW,
) {
  const tenantsRepo = new InMemoryTenantRepository(tenants);
  const sessionsRepo = new InMemoryLabSessionRepository(sessions);
  const svc = new UsageService({
    tenants: tenantsRepo,
    sessions: sessionsRepo,
    now: () => now,
  });
  return { svc, tenantsRepo, sessionsRepo };
}

test('summarize bills a completed session for its wall-clock duration', async () => {
  const { svc } = await fixture([tenant()], [session()]);
  const view = await svc.summarize('t1');
  // 30 minutes at 2 cents/hour => ceil(0.5*2)=1 cent, plus 1 cent to provision.
  assert.equal(view.totalCents, 2);
  assert.equal(view.byTier.tier_2_container, 2);
  assert.equal(view.activeSessions, 0);
});

test('an active session is billed up to now', async () => {
  const { svc } = await fixture(
    [tenant()],
    [session({ status: 'ACTIVE', lastActivityAt: new Date('2026-03-15T10:00:00Z') })],
  );
  const view = await svc.summarize('t1');
  // 2 hours at 2 cents/hour => 4 cents, plus 1 cent to provision.
  assert.equal(view.totalCents, 5);
  assert.equal(view.activeSessions, 1);
});

test('sessions from a previous month are excluded from this period', async () => {
  const { svc } = await fixture(
    [tenant()],
    [
      session({ id: 'old', startedAt: new Date('2026-02-10T10:00:00Z'), lastActivityAt: new Date('2026-02-10T10:30:00Z') }),
      session({ id: 'new' }),
    ],
  );
  const view = await svc.summarize('t1');
  assert.equal(view.totalCents, 2);
  assert.equal(view.periodStart, '2026-03-01T00:00:00.000Z');
});

test('the budget block is present only when a ceiling is set', async () => {
  const noBudget = await fixture([tenant()], [session()]);
  assert.equal((await noBudget.svc.summarize('t1')).budget, null);

  const withBudget = await fixture(
    [tenant({ monthlyBudgetCents: 100 })],
    [session()],
  );
  const view = await withBudget.svc.summarize('t1');
  assert.deepEqual(view.budget, {
    monthlyBudgetCents: 100,
    spentCents: 2,
    percent: 2,
    level: 'ok',
  });
});

test('checkLaunch allows a tenant under its limits', async () => {
  const { svc } = await fixture([tenant()], [session()]);
  assert.equal(await svc.checkLaunch('t1', 5), null);
});

test('checkLaunch blocks a tenant at its concurrency limit', async () => {
  const { svc } = await fixture(
    [tenant({ maxConcurrentLabs: 1 })],
    [session({ status: 'ACTIVE' })],
  );
  const denial = await svc.checkLaunch('t1', 0);
  assert.equal(denial?.reason, 'concurrency_exceeded');
});

test('checkLaunch blocks a tenant over its monthly budget', async () => {
  const { svc } = await fixture(
    [tenant({ monthlyBudgetCents: 1 })],
    [session()],
  );
  const denial = await svc.checkLaunch('t1', 0);
  assert.equal(denial?.reason, 'budget_exceeded');
});

test('checkLaunch does not block an unknown tenant', async () => {
  const { svc } = await fixture([tenant()], []);
  assert.equal(await svc.checkLaunch('missing', 0), null);
});
