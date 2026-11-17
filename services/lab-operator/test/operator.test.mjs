import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LabOperator } from '../dist/operator.js';

const TIERS = ['tier_1_microvm', 'tier_2_container', 'tier_3_vcluster'];

function zeroTiers() {
  return { tier_1_microvm: 0, tier_2_container: 0, tier_3_vcluster: 0 };
}

function makePorts(overrides = {}) {
  const calls = { provision: [], registerWarm: [], terminate: [] };
  const provider = {
    name: 'fake',
    async provision(spec) {
      calls.provision.push(spec);
      return {
        session_id: spec.session_id,
        status: 'WARM',
        tier: spec.runtime_tier,
        provider_ref: `ref-${spec.session_id}`,
        started_at: new Date().toISOString(),
        last_activity_at: new Date().toISOString(),
        ttl_seconds: spec.ttl_seconds,
      };
    },
    async status() {
      return null;
    },
    async heartbeat() {
      throw new Error('unused');
    },
    async terminate() {},
  };

  const ports = {
    provider,
    calls,
    async getInventory() {
      return { ready: zeroTiers(), booting: zeroTiers() };
    },
    async listSessions() {
      return [];
    },
    async terminateSession(id) {
      calls.terminate.push(id);
    },
    async registerWarm(tier, ref) {
      calls.registerWarm.push({ tier, ref });
    },
    ...overrides,
  };
  return ports;
}

const config = {
  target: { tier_1_microvm: 0, tier_2_container: 3, tier_3_vcluster: 0 },
  maxInFlightPerTier: 2,
  idleLimitsSeconds: { tier_1_microvm: 900, tier_2_container: 1800, tier_3_vcluster: 1200 },
};

test('tick boots up to the in-flight cap and registers each warm sandbox', async () => {
  const ports = makePorts();
  const report = await new LabOperator(ports, config).tick();
  assert.equal(report.booted, 2);
  assert.equal(ports.calls.provision.length, 2);
  assert.equal(ports.calls.registerWarm.length, 2);
  assert.equal(ports.calls.registerWarm[0].tier, 'tier_2_container');
  assert.match(ports.calls.registerWarm[0].ref, /^ref-warm-/);
  assert.deepEqual(report.errors, []);
});

test('a failing boot is recorded but does not abort the tick', async () => {
  let attempts = 0;
  const ports = makePorts();
  ports.provider.provision = async (spec) => {
    attempts += 1;
    if (attempts === 1) throw new Error('cluster unavailable');
    return {
      session_id: spec.session_id,
      status: 'WARM',
      tier: spec.runtime_tier,
      provider_ref: 'ref-ok',
      started_at: new Date().toISOString(),
      last_activity_at: new Date().toISOString(),
      ttl_seconds: spec.ttl_seconds,
    };
  };
  const report = await new LabOperator(ports, config).tick();
  assert.equal(report.booted, 1);
  assert.equal(report.errors.length, 1);
  assert.match(report.errors[0], /cluster unavailable/);
});

test('tick terminates ACTIVE sessions idle past their tier limit', async () => {
  const now = Date.parse('2026-01-01T12:00:00Z');
  const ports = makePorts({
    async listSessions() {
      return [
        {
          id: 'idle',
          tier: 'tier_2_container',
          status: 'ACTIVE',
          lastActivityAt: new Date(now - 2000_000),
        },
        {
          id: 'busy',
          tier: 'tier_2_container',
          status: 'ACTIVE',
          lastActivityAt: new Date(now - 1000),
        },
      ];
    },
  });
  const report = await new LabOperator(ports, { ...config, target: zeroTiers() }).tick(now);
  assert.deepEqual(report.terminatedIdle, ['idle']);
  assert.deepEqual(ports.calls.terminate, ['idle']);
});

test('a terminate failure is recorded and other sessions still sweep', async () => {
  const now = Date.parse('2026-01-01T12:00:00Z');
  const ports = makePorts({
    async listSessions() {
      return [
        { id: 'a', tier: 'tier_2_container', status: 'ACTIVE', lastActivityAt: new Date(now - 2000_000) },
        { id: 'b', tier: 'tier_2_container', status: 'ACTIVE', lastActivityAt: new Date(now - 2000_000) },
      ];
    },
    async terminateSession(id) {
      ports.calls.terminate.push(id);
      if (id === 'a') throw new Error('already gone');
    },
  });
  const report = await new LabOperator(ports, { ...config, target: zeroTiers() }).tick(now);
  assert.deepEqual(report.terminatedIdle, ['b']);
  assert.equal(report.errors.length, 1);
});

test('a pool already at target is a no-op', async () => {
  const ports = makePorts({
    async getInventory() {
      return { ready: { ...zeroTiers(), tier_2_container: 3 }, booting: zeroTiers() };
    },
  });
  const report = await new LabOperator(ports, config).tick();
  assert.equal(report.booted, 0);
  assert.equal(report.reaped, 0);
  assert.deepEqual(report.terminatedIdle, []);
});

test('surplus ready sandboxes are reported as reaped', async () => {
  const ports = makePorts({
    async getInventory() {
      return { ready: { ...zeroTiers(), tier_2_container: 6 }, booting: zeroTiers() };
    },
  });
  const report = await new LabOperator(ports, config).tick();
  assert.equal(report.reaped, 3);
  assert.equal(report.booted, 0);
});

// --------------------------------------------------- fork stop-when-idle (ADR-20)

function makeForkPorts(forks, overrides = {}) {
  const calls = { stopFork: [], archiveFork: [] };
  const ports = makePorts({
    async getInventory() {
      // Empty pool so the tick only exercises the fork sweep.
      return { ready: zeroTiers(), booting: zeroTiers() };
    },
    async listForks() {
      return forks;
    },
    async stopFork(id) {
      calls.stopFork.push(id);
    },
    async archiveFork(id) {
      calls.archiveFork.push(id);
    },
    ...overrides,
  });
  ports.forkCalls = calls;
  return ports;
}

const FORK_CONFIG = {
  target: { tier_1_microvm: 0, tier_2_container: 0, tier_3_vcluster: 0 },
  maxInFlightPerTier: 1,
  idleLimitsSeconds: { tier_1_microvm: 900, tier_2_container: 1800, tier_3_vcluster: 1200 },
};

test('an idle running fork is suspended and reported', async () => {
  const now = Date.now();
  const ports = makeForkPorts([
    { id: 'w1', status: 'running', createdAt: new Date(now), lastActivityAt: new Date(now - 3601_000) },
  ]);
  const report = await new LabOperator(ports, FORK_CONFIG).tick(now);
  assert.deepEqual(report.stoppedForks, ['w1']);
  assert.deepEqual(ports.forkCalls.stopFork, ['w1']);
  assert.deepEqual(report.errors, []);
});

test('a fresh running fork is left alone', async () => {
  const now = Date.now();
  const ports = makeForkPorts([
    { id: 'w1', status: 'running', createdAt: new Date(now), lastActivityAt: new Date(now - 60_000) },
  ]);
  const report = await new LabOperator(ports, FORK_CONFIG).tick(now);
  assert.deepEqual(report.stoppedForks, []);
});

test('a long-stopped fork is archived', async () => {
  const now = Date.now();
  const day = 24 * 3600 * 1000;
  const ports = makeForkPorts([
    { id: 'w1', status: 'stopped', createdAt: new Date(now - 200 * day), lastActivityAt: new Date(now - 91 * day) },
  ]);
  const report = await new LabOperator(ports, FORK_CONFIG).tick(now);
  assert.deepEqual(report.archivedForks, ['w1']);
  assert.deepEqual(ports.forkCalls.archiveFork, ['w1']);
});

test('a failing fork stop is recorded but does not abort the tick', async () => {
  const now = Date.now();
  const ports = makeForkPorts(
    [
      { id: 'w1', status: 'running', createdAt: new Date(now), lastActivityAt: new Date(now - 3601_000) },
    ],
    {
      async stopFork() {
        throw new Error('cluster unavailable');
      },
    },
  );
  const report = await new LabOperator(ports, FORK_CONFIG).tick(now);
  assert.deepEqual(report.stoppedForks, []);
  assert.equal(report.errors.length, 1);
  assert.match(report.errors[0], /stop fork w1/);
});

test('a deployment without fork ports skips the fork sweep entirely', async () => {
  const now = Date.now();
  // makePorts has no listForks/stopFork, so the sweep must be a no-op.
  const report = await new LabOperator(makePorts(), config).tick(now);
  assert.deepEqual(report.stoppedForks, []);
  assert.deepEqual(report.archivedForks, []);
});
