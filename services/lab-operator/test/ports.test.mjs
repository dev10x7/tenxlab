import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseKubeConfig, PodProvider, RoutingProvider } from '@tenxlab/lab-provider';
import { LabOperator } from '../dist/operator.js';
import { PgOperatorPorts } from '../dist/ports.js';

/** Fake pg pool that answers the operator's handful of queries from memory. */
function fakePool(state = {}) {
  const calls = [];
  const warm = state.warm ?? [];
  const sessions = state.sessions ?? [];
  return {
    calls,
    async query(text, values) {
      calls.push({ text, values });
      if (text.includes('FROM warm_sandboxes')) {
        const counts = new Map();
        for (const w of warm) counts.set(w.tier, (counts.get(w.tier) ?? 0) + 1);
        return { rows: [...counts].map(([tier, count]) => ({ tier, count: String(count) })) };
      }
      if (text.includes('FROM lab_sessions WHERE id')) {
        const row = sessions.find((s) => s.id === values[0]);
        return { rows: row ? [{ kubelabRef: row.kubelabRef }] : [] };
      }
      if (text.includes('FROM lab_sessions')) {
        return { rows: sessions.filter((s) => s.status === 'ACTIVE') };
      }
      if (text.includes('INSERT INTO warm_sandboxes')) {
        warm.push({ tier: values[1], providerRef: values[2] });
        return { rows: [] };
      }
      if (text.includes('UPDATE lab_sessions')) {
        const row = sessions.find((s) => s.id === values[0]);
        if (row) row.status = 'TERMINATED';
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
}

function fakeProvider() {
  const terminated = [];
  return {
    terminated,
    name: 'fake',
    async provision() {
      throw new Error('unused');
    },
    async status() {
      return null;
    },
    async heartbeat() {
      throw new Error('unused');
    },
    async terminate(ref) {
      terminated.push(ref);
    },
  };
}

test('getInventory counts warm sandboxes per tier', async () => {
  const pool = fakePool({
    warm: [
      { tier: 'tier_2_container' },
      { tier: 'tier_2_container' },
      { tier: 'tier_3_vcluster' },
    ],
  });
  const ports = new PgOperatorPorts({ pool, provider: fakeProvider() });
  const inventory = await ports.getInventory();
  assert.equal(inventory.ready.tier_2_container, 2);
  assert.equal(inventory.ready.tier_3_vcluster, 1);
  assert.equal(inventory.ready.tier_1_microvm, 0);
  assert.deepEqual(inventory.booting, {
    tier_1_microvm: 0,
    tier_2_container: 0,
    tier_3_vcluster: 0,
  });
});

test('listSessions returns only ACTIVE sessions with parsed dates', async () => {
  const pool = fakePool({
    sessions: [
      { id: 'a', tier: 'tier_2_container', status: 'ACTIVE', lastActivityAt: '2026-01-01T00:00:00Z' },
      { id: 'b', tier: 'tier_2_container', status: 'TERMINATED', lastActivityAt: '2026-01-01T00:00:00Z' },
    ],
  });
  const ports = new PgOperatorPorts({ pool, provider: fakeProvider() });
  const sessions = await ports.listSessions();
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].id, 'a');
  assert.ok(sessions[0].lastActivityAt instanceof Date);
});

test('registerWarm inserts a row with a generated id', async () => {
  const pool = fakePool();
  const ports = new PgOperatorPorts({ pool, provider: fakeProvider() });
  await ports.registerWarm('tier_2_container', 'tenxlab-t2-warm-1');
  const insert = pool.calls.find((c) => c.text.includes('INSERT INTO warm_sandboxes'));
  assert.ok(insert);
  assert.match(insert.values[0], /^[0-9a-f-]{36}$/);
  assert.equal(insert.values[1], 'tier_2_container');
  assert.equal(insert.values[2], 'tenxlab-t2-warm-1');
});

test('terminateSession tears down the provider ref then marks the row', async () => {
  const pool = fakePool({
    sessions: [
      {
        id: 's1',
        tier: 'tier_2_container',
        status: 'ACTIVE',
        lastActivityAt: new Date().toISOString(),
        kubelabRef: 'tenxlab-t2-s1',
      },
    ],
  });
  const provider = fakeProvider();
  const ports = new PgOperatorPorts({ pool, provider });
  await ports.terminateSession('s1');
  assert.deepEqual(provider.terminated, ['tenxlab-t2-s1']);
  assert.ok(pool.calls.some((c) => c.text.includes('UPDATE lab_sessions')));
});

test('parseKubeConfig lifts server, token and base64 CA', () => {
  const ca = Buffer.from('CA-PEM').toString('base64');
  const cfg = parseKubeConfig(
    [
      'clusters:',
      '  - cluster:',
      '      server: https://10.0.0.1:6443',
      `      certificate-authority-data: ${ca}`,
      'users:',
      '  - user:',
      '      token: abc123',
    ].join('\n'),
  );
  assert.equal(cfg.serverUrl, 'https://10.0.0.1:6443');
  assert.equal(cfg.token, 'abc123');
  assert.equal(cfg.caCert, 'CA-PEM');
});

test('a tick boots warm tier-2 pods through the real provider and DB ports', async () => {
  const applied = [];
  const cluster = {
    async apply(m) {
      applied.push(m.kind);
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
      fetchImpl: async () => ({ status: 200 }),
    }),
  });
  const pool = fakePool({ sessions: [] });
  const ports = new PgOperatorPorts({ pool, provider });
  const operator = new LabOperator(ports, {
    target: { tier_1_microvm: 0, tier_2_container: 2, tier_3_vcluster: 0 },
    maxInFlightPerTier: 5,
    idleLimitsSeconds: { tier_1_microvm: 900, tier_2_container: 1800, tier_3_vcluster: 1200 },
  });

  const report = await operator.tick();
  assert.equal(report.errors.length, 0);
  assert.equal(report.booted, 2);
  // Each boot registers a warm sandbox row keyed by its namespace.
  const inserts = pool.calls.filter((c) => c.text.includes('INSERT INTO warm_sandboxes'));
  assert.equal(inserts.length, 2);
  assert.ok(inserts.every((c) => c.values[1] === 'tier_2_container'));
  // And each boot applied a full pod set to the cluster.
  assert.equal(applied.filter((k) => k === 'Namespace').length, 2);
  assert.equal(applied.filter((k) => k === 'Pod').length, 2);
});
