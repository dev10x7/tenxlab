import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LabSpec } from '@tenxlab/contracts';
import { KubeLabAdapter } from '../dist/index.js';

/** Minimal fetch stub that records calls and returns canned responses. */
function stubFetch(handler) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, method: init?.method, headers: init?.headers, body: init?.body });
    const { status = 200, json = {} } = handler(url, init) ?? {};
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => json,
      text: async () => JSON.stringify(json),
    };
  };
  return { impl, calls };
}

const spec = LabSpec.parse({
  exercise_id: 'create-simple-pod',
  runtime_tier: 'tier_3_vcluster',
  tenant_id: 't1',
  user_id: 'u1',
  session_id: 'sess-1',
});

test('launchUrl URL-encodes the token', () => {
  const adapter = new KubeLabAdapter({ baseUrl: 'https://kubelab.example.com/' });
  const url = adapter.launchUrl('a.b+c/d==');
  assert.equal(
    url,
    'https://kubelab.example.com/launch?token=a.b%2Bc%2Fd%3D%3D',
  );
});

test('provision maps the tier to a KubeLab profile and returns a handle', async () => {
  const { impl, calls } = stubFetch(() => ({
    status: 201,
    json: {
      id: 'kl-123',
      externalSessionId: 'sess-1',
      status: 'RUNNING',
      ideUrl: 'https://ide.example.com/sess-1',
      tier: 'tier_3_vcluster',
      ttlSeconds: 1800,
    },
  }));
  const adapter = new KubeLabAdapter({
    baseUrl: 'https://kubelab.example.com',
    apiToken: 'svc-token',
    fetchImpl: impl,
  });
  const handle = await adapter.provision(spec);
  assert.equal(handle.status, 'ACTIVE');
  assert.equal(handle.provider_ref, 'kl-123');
  assert.equal(handle.ide_url, 'https://ide.example.com/sess-1');

  const sent = JSON.parse(calls[0].body);
  assert.equal(sent.profile, 'vcluster-k8s');
  assert.equal(calls[0].headers.authorization, 'Bearer svc-token');
});

test('status returns null on 404', async () => {
  const { impl } = stubFetch(() => ({ status: 404, json: {} }));
  const adapter = new KubeLabAdapter({
    baseUrl: 'https://kubelab.example.com',
    fetchImpl: impl,
  });
  assert.equal(await adapter.status('missing'), null);
});

test('status maps clusterRunning=true to ACTIVE', async () => {
  const { impl } = stubFetch(() => ({
    status: 200,
    json: { id: 'kl-1', externalSessionId: 'sess-1', clusterRunning: true },
  }));
  const adapter = new KubeLabAdapter({
    baseUrl: 'https://kubelab.example.com',
    fetchImpl: impl,
  });
  const handle = await adapter.status('sess-1');
  assert.equal(handle.status, 'ACTIVE');
});

test('non-2xx responses raise LabProviderError with status', async () => {
  const { impl } = stubFetch(() => ({
    status: 503,
    json: { error: 'unavailable' },
  }));
  const adapter = new KubeLabAdapter({
    baseUrl: 'https://kubelab.example.com',
    fetchImpl: impl,
  });
  await assert.rejects(
    () => adapter.provision(spec),
    (err) => err.name === 'LabProviderError' && err.status === 503,
  );
});

test('terminate issues a DELETE and tolerates 404', async () => {
  const { impl, calls } = stubFetch(() => ({ status: 404, json: {} }));
  const adapter = new KubeLabAdapter({
    baseUrl: 'https://kubelab.example.com',
    fetchImpl: impl,
  });
  await adapter.terminate('gone');
  assert.equal(calls[0].method, 'DELETE');
});
