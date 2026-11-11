import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveTarget, upstreamHeaders } from '../ide-gateway.mjs';

test('resolveTarget splits /lab/<host>/<rest>', () => {
  assert.deepEqual(resolveTarget('/lab/kubelab-a-b-c.10.0.0.1.nip.io/x/y?q=1'), {
    host: 'kubelab-a-b-c.10.0.0.1.nip.io',
    path: '/x/y?q=1',
  });
});

test('resolveTarget defaults to / for a bare host', () => {
  assert.deepEqual(resolveTarget('/lab/host.example'), { host: 'host.example', path: '/' });
});

test('resolveTarget rejects paths outside the /lab prefix', () => {
  assert.equal(resolveTarget('/other/host.example/x'), null);
  assert.equal(resolveTarget('/lab/nodot'), null);
});

test('upstreamHeaders rewrites Origin to the upstream host', () => {
  const out = upstreamHeaders(
    { host: 'gw.example.com', origin: 'https://gw.example.com', cookie: 'a=b' },
    'kubelab-a-b-c.10.0.0.1.nip.io',
  );
  assert.equal(out.host, 'kubelab-a-b-c.10.0.0.1.nip.io');
  assert.equal(out.origin, 'https://kubelab-a-b-c.10.0.0.1.nip.io');
  assert.equal(out.cookie, 'a=b');
});

test('upstreamHeaders leaves requests without Origin untouched', () => {
  const out = upstreamHeaders({ host: 'gw.example.com' }, 'up.example');
  assert.equal(out.host, 'up.example');
  assert.equal(out.origin, undefined);
});
