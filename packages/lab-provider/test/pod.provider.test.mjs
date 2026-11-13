import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LabSpec } from '@tenxlab/contracts';
import { PodProvider, namespaceFor } from '../dist/index.js';

/**
 * In-memory fake of the Kubernetes API slice the provider needs. Records every
 * apply/delete so tests can assert which objects a session creates, and answers
 * reads from the same store.
 */
function fakeCluster(options = {}) {
  const store = new Map(); // `${kind}/${ns}/${name}` -> object
  const calls = { applied: [], deleted: [], got: [], listed: [] };
  const key = (kind, ns, name) => `${kind}/${ns}/${name}`;

  return {
    calls,
    store,
    async apply(manifest) {
      calls.applied.push(manifest);
      const kind = manifest.kind;
      const ns = manifest.metadata?.namespace ?? '';
      const name = manifest.metadata?.name;
      store.set(key(kind, ns, name), manifest);
    },
    async delete(kind, name, ns) {
      calls.deleted.push({ kind, name, namespace: ns });
      store.delete(key(kind, ns, name));
    },
    async get(kind, name, ns) {
      calls.got.push({ kind, name, namespace: ns });
      return store.get(key(kind, ns, name)) ?? null;
    },
    async list(kind, ns) {
      calls.listed.push({ kind, namespace: ns });
      return [...store.values()].filter(
        (o) => o.kind === kind && (o.metadata?.namespace ?? '') === ns,
      );
    },
  };
}

/** A pod that reports Ready=True, for status() assertions. */
function readyPod(ns) {
  return {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: { name: 'code-server', namespace: ns, creationTimestamp: '2026-01-01T00:00:00Z' },
    status: { phase: 'Running', conditions: [{ type: 'Ready', status: 'True' }] },
  };
}

function provider(cluster, opts = {}) {
  return new PodProvider({
    cluster,
    allowedHosts: '192.168.49.2.nip.io',
    fetchImpl: async () => ({ status: 200 }),
    ...opts,
  });
}

const spec = LabSpec.parse({
  exercise_id: 'build-a-web-app',
  runtime_tier: 'tier_2_container',
  tenant_id: 't1',
  user_id: 'u1',
  session_id: 'sess-1',
});

test('ideUrlFor builds the per-session ingress host', () => {
  const p = provider(fakeCluster());
  assert.equal(
    p.ideUrlFor('sess-1'),
    'https://tenxlab-t2-sess-1.192.168.49.2.nip.io/',
  );
});

test('ideUrlFor routes through the public gateway when one is configured', () => {
  const p = provider(fakeCluster(), { publicIdeBaseUrl: 'https://labs.example.com' });
  assert.equal(
    p.ideUrlFor('sess-1'),
    'https://labs.example.com/lab/tenxlab-t2-sess-1.192.168.49.2.nip.io/',
  );
});

test('provision creates namespace, pvc, pod, service and ingress', async () => {
  const cluster = fakeCluster();
  const handle = await provider(cluster).provision(spec);

  const kinds = cluster.calls.applied.map((m) => m.kind);
  assert.deepEqual(kinds, [
    'Namespace',
    'PersistentVolumeClaim',
    'Pod',
    'Service',
    'Ingress',
  ]);

  const ns = cluster.calls.applied[0].metadata.name;
  assert.equal(ns, 'tenxlab-t2-sess-1');
  assert.equal(cluster.calls.applied[0].metadata.annotations['tenxlab.io/tenant'], 't1');
  assert.equal(cluster.calls.applied[0].metadata.annotations['tenxlab.io/user'], 'u1');

  const ingress = cluster.calls.applied.find((m) => m.kind === 'Ingress');
  assert.equal(ingress.spec.rules[0].host, 'tenxlab-t2-sess-1.192.168.49.2.nip.io');
  assert.equal(ingress.spec.rules[0].http.paths[0].backend.service.name, 'code-server');

  assert.equal(handle.status, 'ACTIVE');
  assert.equal(handle.tier, 'tier_2_container');
  assert.equal(handle.provider_ref, 'tenxlab-t2-sess-1');
  assert.match(handle.ide_url, /^https:\/\/tenxlab-t2-sess-1\.192\.168\.49\.2\.nip\.io\/$/);
});

test('provision honours declared resource limits', async () => {
  const cluster = fakeCluster();
  await provider(cluster).provision(
    LabSpec.parse({ ...spec, resource_limits: { cpu: '2', memory: '2Gi' } }),
  );
  const pod = cluster.calls.applied.find((m) => m.kind === 'Pod');
  assert.deepEqual(pod.spec.containers[0].resources.limits, { cpu: '2', memory: '2Gi' });
});

test('provision reports WARM when the IDE does not answer in time', async () => {
  const cluster = fakeCluster();
  const p = provider(cluster, {
    readinessTimeoutMs: 5,
    readinessPollMs: 1,
    fetchImpl: async () => {
      throw new Error('ECONNREFUSED');
    },
  });
  const handle = await p.provision(spec);
  assert.equal(handle.status, 'WARM');
});

test('provision rejects a tier it does not own', async () => {
  const p = provider(fakeCluster());
  await assert.rejects(
    () => p.provision(LabSpec.parse({ ...spec, runtime_tier: 'tier_3_vcluster' })),
    /only serves tier_2_container/,
  );
});

test('status reports ACTIVE only when the pod is Ready', async () => {
  const cluster = fakeCluster();
  await cluster.apply(readyPod('tenxlab-t2-sess-1'));
  const handle = await provider(cluster).status('sess-1');
  assert.equal(handle.status, 'ACTIVE');
  assert.equal(handle.started_at, '2026-01-01T00:00:00.000Z');
});

test('status reports WARM when the pod exists but is not Ready', async () => {
  const cluster = fakeCluster();
  await cluster.apply({
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: { name: 'code-server', namespace: 'tenxlab-t2-sess-1' },
    status: { phase: 'Pending', conditions: [{ type: 'Ready', status: 'False' }] },
  });
  const handle = await provider(cluster).status('sess-1');
  assert.equal(handle.status, 'WARM');
});

test('status returns null once the namespace is gone', async () => {
  const handle = await provider(fakeCluster()).status('sess-1');
  assert.equal(handle, null);
});

test('terminate deletes the namespace, cascading to its objects', async () => {
  const cluster = fakeCluster();
  await provider(cluster).terminate('sess-1');
  assert.deepEqual(cluster.calls.deleted, [
    { kind: 'Namespace', name: 'tenxlab-t2-sess-1', namespace: '' },
  ]);
});

test('terminate waits for the namespace to disappear (Terminating race)', async () => {
  // The namespace lingers after DELETE while its resources finalise; terminate
  // must block until it is gone so a resume does not re-apply onto a Terminating
  // namespace.
  let present = true;
  let gets = 0;
  const cluster = {
    async delete() {},
    async get() {
      gets += 1;
      // Still present on the first two reads, gone thereafter.
      if (gets > 2) present = false;
      return present ? { kind: 'Namespace' } : null;
    },
  };
  await provider(cluster, { terminatePollMs: 5 }).terminate('sess-1');
  assert.ok(gets >= 3, `expected to poll until gone, got ${gets} reads`);
});

test('namespaceFor produces a valid DNS-1123 label from an arbitrary id', () => {
  assert.equal(namespaceFor('sess-1'), 'tenxlab-t2-sess-1');
  assert.equal(namespaceFor('Sess_1.A'), 'tenxlab-t2-sess-1-a');
  assert.match(namespaceFor('x'.repeat(80)), /^tenxlab-t2-x{40}$/);
});

test('namespaceFor is idempotent, so a provider_ref round-trips', async () => {
  assert.equal(namespaceFor('tenxlab-t2-sess-1'), 'tenxlab-t2-sess-1');
  const cluster = fakeCluster();
  const p = provider(cluster);
  const handle = await p.provision(spec);
  await p.terminate(handle.provider_ref);
  assert.equal(cluster.calls.deleted[0].name, 'tenxlab-t2-sess-1');
});
