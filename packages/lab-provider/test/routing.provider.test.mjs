import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LabSpec } from '@tenxlab/contracts';
import { RoutingProvider, LabProviderError } from '../dist/index.js';

function fakeProvider(name, overrides = {}) {
  return {
    name,
    calls: { provision: [], terminate: [] },
    async provision(spec) {
      this.calls.provision.push(spec);
      return {
        session_id: spec.session_id,
        status: 'ACTIVE',
        tier: spec.runtime_tier,
        ide_url: `https://${name}.example.com/`,
        provider_ref: `${name}-ref`,
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
    async terminate() {
      this.calls.terminate.push(name);
    },
    ...overrides,
  };
}

function specFor(tier) {
  return LabSpec.parse({
    exercise_id: 'ex',
    runtime_tier: tier,
    tenant_id: 't1',
    user_id: 'u1',
    session_id: 'sess-1',
  });
}

test('provision dispatches to the provider that owns the tier', async () => {
  const pod = fakeProvider('pod');
  const kubelab = fakeProvider('kubelab');
  const router = new RoutingProvider({
    tier_2_container: pod,
    tier_3_vcluster: kubelab,
  });

  await router.provision(specFor('tier_2_container'));
  await router.provision(specFor('tier_3_vcluster'));

  assert.equal(pod.calls.provision.length, 1);
  assert.equal(kubelab.calls.provision.length, 1);
});

test('provision fails loudly for a tier with no provider', async () => {
  const router = new RoutingProvider({ tier_2_container: fakeProvider('pod') });
  await assert.rejects(() => router.provision(specFor('tier_1_microvm')), (err) => {
    assert.ok(err instanceof LabProviderError);
    assert.equal(err.status, 503);
    return true;
  });
});

test('status returns the first provider that recognises the ref', async () => {
  const pod = fakeProvider('pod', {
    async status(id) {
      return id === 'pod-ref'
        ? {
            session_id: id,
            status: 'ACTIVE',
            tier: 'tier_2_container',
            started_at: new Date().toISOString(),
            last_activity_at: new Date().toISOString(),
            ttl_seconds: 1800,
          }
        : null;
    },
  });
  const kubelab = fakeProvider('kubelab');
  const router = new RoutingProvider({ tier_2_container: pod, tier_3_vcluster: kubelab });

  const handle = await router.status('pod-ref');
  assert.equal(handle.tier, 'tier_2_container');
  assert.equal(await router.status('unknown'), null);
});

test('heartbeat and terminate reach the owning provider', async () => {
  const owned = { id: 'ref' };
  const pod = fakeProvider('pod', {
    async status(id) {
      return id === owned.id
        ? {
            session_id: id,
            status: 'ACTIVE',
            tier: 'tier_2_container',
            started_at: new Date().toISOString(),
            last_activity_at: new Date().toISOString(),
            ttl_seconds: 1800,
          }
        : null;
    },
    async heartbeat(id) {
      return {
        session_id: id,
        status: 'ACTIVE',
        tier: 'tier_2_container',
        started_at: new Date().toISOString(),
        last_activity_at: new Date().toISOString(),
        ttl_seconds: 1800,
      };
    },
  });
  const kubelab = fakeProvider('kubelab');
  const router = new RoutingProvider({ tier_2_container: pod, tier_3_vcluster: kubelab });

  assert.equal((await router.heartbeat('ref')).tier, 'tier_2_container');
  await router.terminate('ref');
  assert.deepEqual(pod.calls.terminate, ['pod']);
  assert.deepEqual(kubelab.calls.terminate, []);
});
