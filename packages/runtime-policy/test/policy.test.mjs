import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  routeTier,
  planPoolActions,
  findIdleSessions,
  costSession,
  summarizeTenantCost,
  billableMinutes,
  formatUsd,
  checkQuota,
  checkStorageQuota,
  forkLifecycle,
  findForksToStop,
  findForksToArchive,
  forkStorageGb,
  DEFAULT_FORK_TIER,
  budgetWarning,
  DEFAULT_IDLE_LIMITS,
} from '../dist/index.js';

// -------------------------------------------------------------- tier router

test('declared tier always wins', () => {
  const d = routeTier({
    declaredTier: 'tier_1_microvm',
    requirements: { needsCluster: true },
  });
  assert.equal(d.tier, 'tier_1_microvm');
});

test('an unknown declared tier falls back to container', () => {
  const d = routeTier({ declaredTier: 'tier_9_quantum' });
  assert.equal(d.tier, 'tier_2_container');
  assert.match(d.reason, /unknown/i);
});

test('cluster requirement routes to vcluster', () => {
  assert.equal(
    routeTier({ requirements: { needsCluster: true } }).tier,
    'tier_3_vcluster',
  );
});

test('kernel requirement routes to microVM', () => {
  assert.equal(
    routeTier({ requirements: { needsKernel: true } }).tier,
    'tier_1_microvm',
  );
});

test('cluster requirement outranks kernel requirement', () => {
  assert.equal(
    routeTier({ requirements: { needsKernel: true, needsCluster: true } }).tier,
    'tier_3_vcluster',
  );
});

test('slug hints are used when there are no requirements', () => {
  assert.equal(
    routeTier({ exerciseSlug: 'deploy-nginx-kubernetes' }).tier,
    'tier_3_vcluster',
  );
  assert.equal(
    routeTier({ exerciseSlug: 'write-an-ebpf-probe' }).tier,
    'tier_1_microvm',
  );
});

test('a plain exercise defaults to container', () => {
  assert.equal(
    routeTier({ exerciseSlug: 'create-simple-pod-2' }).tier,
    'tier_2_container',
  );
  assert.equal(routeTier({}).tier, 'tier_2_container');
});

// ---------------------------------------------------------------- warm pool

const poolState = (over = {}) => ({
  ready: { tier_1_microvm: 0, tier_2_container: 0, tier_3_vcluster: 0 },
  booting: { tier_1_microvm: 0, tier_2_container: 0, tier_3_vcluster: 0 },
  ...over,
});

test('pool planner boots the deficit up to the in-flight cap', () => {
  const actions = planPoolActions(poolState(), {
    target: { tier_1_microvm: 0, tier_2_container: 10, tier_3_vcluster: 0 },
    maxInFlightPerTier: 3,
  });
  assert.deepEqual(actions, [
    { tier: 'tier_2_container', action: 'boot', count: 3 },
  ]);
});

test('pool planner accounts for sandboxes already booting', () => {
  const state = poolState();
  state.ready.tier_2_container = 4;
  state.booting.tier_2_container = 2;
  const actions = planPoolActions(state, {
    target: { tier_1_microvm: 0, tier_2_container: 10, tier_3_vcluster: 0 },
    maxInFlightPerTier: 5,
  });
  assert.deepEqual(actions, [
    { tier: 'tier_2_container', action: 'boot', count: 4 },
  ]);
});

test('pool planner reaps surplus ready sandboxes', () => {
  const state = poolState();
  state.ready.tier_2_container = 8;
  const actions = planPoolActions(state, {
    target: { tier_1_microvm: 0, tier_2_container: 5, tier_3_vcluster: 0 },
    maxInFlightPerTier: 5,
  });
  assert.deepEqual(actions, [
    { tier: 'tier_2_container', action: 'reap', count: 3 },
  ]);
});

test('pool planner is a no-op when the pool is at target', () => {
  const state = poolState();
  state.ready.tier_2_container = 5;
  const actions = planPoolActions(state, {
    target: { tier_1_microvm: 0, tier_2_container: 5, tier_3_vcluster: 0 },
    maxInFlightPerTier: 5,
  });
  assert.deepEqual(actions, []);
});

test('idle finder only reaps ACTIVE sessions past their tier limit', () => {
  const now = Date.parse('2026-01-01T12:00:00Z');
  const sessions = [
    {
      id: 'a',
      tier: 'tier_2_container',
      lastActivityAt: new Date(now - 1_800_000),
      status: 'ACTIVE',
    },
    {
      id: 'b',
      tier: 'tier_2_container',
      lastActivityAt: new Date(now - 1000),
      status: 'ACTIVE',
    },
    {
      id: 'c',
      tier: 'tier_1_microvm',
      lastActivityAt: new Date(now - 1_000_000),
      status: 'WARM',
    },
    {
      id: 'd',
      tier: 'tier_1_microvm',
      lastActivityAt: new Date(now - 1_000_000),
      status: 'ACTIVE',
    },
  ];
  const idle = findIdleSessions(sessions, DEFAULT_IDLE_LIMITS, now);
  assert.deepEqual(idle.sort(), ['a', 'd']);
});

// --------------------------------------------------------------------- cost

test('billable minutes round up', () => {
  const start = new Date('2026-01-01T00:00:00Z');
  assert.equal(billableMinutes(start, new Date('2026-01-01T00:00:01Z')), 1);
  assert.equal(billableMinutes(start, new Date('2026-01-01T00:01:01Z')), 2);
});

test('session cost includes the provision fee and time', () => {
  const cost = costSession({
    sessionId: 's1',
    tenantId: 't1',
    tier: 'tier_2_container',
    startedAt: new Date('2026-01-01T00:00:00Z'),
    endedAt: new Date('2026-01-01T01:00:00Z'),
  });
  assert.equal(cost.billableMinutes, 60);
  assert.equal(cost.cents, 3);
});

test('tenant summary only includes that tenant and groups by tier', () => {
  const start = new Date('2026-01-01T00:00:00Z');
  const end = new Date('2026-01-01T01:00:00Z');
  const usage = [
    { sessionId: 's1', tenantId: 't1', tier: 'tier_2_container', startedAt: start, endedAt: end },
    { sessionId: 's2', tenantId: 't1', tier: 'tier_3_vcluster', startedAt: start, endedAt: end },
    { sessionId: 's3', tenantId: 't2', tier: 'tier_2_container', startedAt: start, endedAt: end },
  ];
  const summary = summarizeTenantCost('t1', usage);
  assert.equal(summary.sessions.length, 2);
  assert.equal(summary.totalCents, 3 + (9 + 2));
  assert.equal(summary.byTier.tier_2_container, 3);
});

test('formatUsd renders cents as dollars', () => {
  assert.equal(formatUsd(0), '$0.00');
  assert.equal(formatUsd(5), '$0.05');
  assert.equal(formatUsd(1234), '$12.34');
});

// -------------------------------------------------------------------- quota

test('quota allows a launch under both limits', () => {
  const d = checkQuota({
    quota: { maxConcurrentLabs: 10, monthlyBudgetCents: 10_000 },
    activeSessions: 3,
    spentThisPeriodCents: 500,
  });
  assert.equal(d.allowed, true);
});

test('quota blocks when concurrency is reached', () => {
  const d = checkQuota({
    quota: { maxConcurrentLabs: 3, monthlyBudgetCents: 0 },
    activeSessions: 3,
    spentThisPeriodCents: 0,
  });
  assert.equal(d.allowed, false);
  assert.equal(d.allowed === false && d.reason, 'concurrency_exceeded');
});

test('quota blocks when the projected spend exceeds budget', () => {
  const d = checkQuota({
    quota: { maxConcurrentLabs: 100, monthlyBudgetCents: 1000 },
    activeSessions: 0,
    spentThisPeriodCents: 990,
    estimatedCostCents: 20,
  });
  assert.equal(d.allowed, false);
  assert.equal(d.allowed === false && d.reason, 'budget_exceeded');
});

test('a zero budget means unlimited', () => {
  const d = checkQuota({
    quota: { maxConcurrentLabs: 5, monthlyBudgetCents: 0 },
    activeSessions: 0,
    spentThisPeriodCents: 999_999,
  });
  assert.equal(d.allowed, true);
});

test('budget warning escalates at the threshold and beyond', () => {
  const quota = { maxConcurrentLabs: 5, monthlyBudgetCents: 1000 };
  assert.equal(budgetWarning(quota, 500)?.level, 'ok');
  assert.equal(budgetWarning(quota, 850)?.level, 'warning');
  assert.equal(budgetWarning(quota, 1000)?.level, 'exceeded');
  assert.equal(budgetWarning({ maxConcurrentLabs: 1, monthlyBudgetCents: 0 }, 999), null);
});

// --------------------------------------------------------------- fork policy

test('storage quota blocks when the projected fork storage exceeds the cap', () => {
  const d = checkQuota({
    quota: { maxConcurrentLabs: 100, monthlyBudgetCents: 0, maxStorageGb: 10 },
    activeSessions: 0,
    spentThisPeriodCents: 0,
    storageUsedGb: 9,
    estimatedStorageGb: 2,
  });
  assert.equal(d.allowed, false);
  assert.equal(d.allowed === false && d.reason, 'storage_exceeded');
});

test('storage quota allows a fork within the cap, and is unlimited at 0', () => {
  const within = checkQuota({
    quota: { maxConcurrentLabs: 100, monthlyBudgetCents: 0, maxStorageGb: 10 },
    activeSessions: 0,
    spentThisPeriodCents: 0,
    storageUsedGb: 8,
    estimatedStorageGb: 2,
  });
  assert.equal(within.allowed, true);
  const unlimited = checkQuota({
    quota: { maxConcurrentLabs: 100, monthlyBudgetCents: 0, maxStorageGb: 0 },
    activeSessions: 0,
    spentThisPeriodCents: 0,
    storageUsedGb: 9999,
    estimatedStorageGb: 1,
  });
  assert.equal(unlimited.allowed, true);
});

test('checkStorageQuota gates only the storage dimension, independent of a launch', () => {
  const cap = { maxConcurrentLabs: 100, monthlyBudgetCents: 0, maxStorageGb: 10 };
  assert.equal(checkStorageQuota(cap, 8, 2).allowed, true);
  assert.equal(checkStorageQuota(cap, 9, 2).allowed, false);
  const over = checkStorageQuota(cap, 9, 2);
  assert.equal(over.allowed === false && over.reason, 'storage_exceeded');
  // An unset or zero ceiling is unlimited.
  assert.equal(checkStorageQuota({ maxConcurrentLabs: 1, monthlyBudgetCents: 0 }, 9999, 5).allowed, true);
  assert.equal(checkStorageQuota({ maxConcurrentLabs: 1, monthlyBudgetCents: 0, maxStorageGb: 0 }, 9999, 5).allowed, true);
});

test('a fork running past its idle limit is stopped; a stopped one is not', () => {
  const now = Date.now();
  const lifecycle = forkLifecycle();
  const running = { id: 'f1', status: 'running', createdAt: new Date(now), lastActivityAt: new Date(now - 3601_000) };
  const fresh = { id: 'f2', status: 'running', createdAt: new Date(now), lastActivityAt: new Date(now - 60_000) };
  const stopped = { id: 'f3', status: 'stopped', createdAt: new Date(now), lastActivityAt: new Date(now - 9999_000) };
  assert.deepEqual(findForksToStop([running, fresh, stopped], lifecycle, now), ['f1']);
});

test('a fork alive past the max session is stopped even when active', () => {
  const now = Date.now();
  const lifecycle = forkLifecycle();
  const longLived = {
    id: 'f1',
    status: 'running',
    createdAt: new Date(now - 8 * 3600 * 1000 - 1000),
    lastActivityAt: new Date(now),
  };
  assert.deepEqual(findForksToStop([longLived], lifecycle, now), ['f1']);
});

test('a fork stopped past retention is archived; a fresh stop is not', () => {
  const now = Date.now();
  const lifecycle = forkLifecycle();
  const day = 24 * 3600 * 1000;
  const old = { id: 'f1', status: 'stopped', createdAt: new Date(now - 200 * day), lastActivityAt: new Date(now - 91 * day) };
  const recent = { id: 'f2', status: 'stopped', createdAt: new Date(now - 2 * day), lastActivityAt: new Date(now - day) };
  const running = { id: 'f3', status: 'running', createdAt: new Date(now), lastActivityAt: new Date(now - 200 * day) };
  assert.deepEqual(findForksToArchive([old, recent, running], lifecycle, now), ['f1']);
});

test('fork storage is tier-sized', () => {
  assert.equal(forkStorageGb('tier_2_container'), 2);
  assert.equal(forkStorageGb('tier_3_vcluster'), 4);
  assert.equal(DEFAULT_FORK_TIER, 'tier_2_container');
});
