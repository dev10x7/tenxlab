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
