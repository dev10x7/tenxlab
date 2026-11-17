import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveTarget, upstreamHeaders, sanitizeResponseHeaders } from '../ide-gateway.mjs';

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

test('sanitizeResponseHeaders drops X-Frame-Options so the IDE can embed', () => {
  const out = sanitizeResponseHeaders({
    'content-type': 'text/html',
    'X-Frame-Options': 'SAMEORIGIN',
  });
  assert.equal(out['X-Frame-Options'], undefined);
  assert.equal(out['content-type'], 'text/html');
});

test('sanitizeResponseHeaders strips only frame-ancestors from CSP', () => {
  const out = sanitizeResponseHeaders({
    'content-security-policy':
      "default-src 'self'; frame-ancestors 'self'; script-src 'unsafe-inline'",
  });
  assert.equal(
    out['content-security-policy'],
    "default-src 'self'; script-src 'unsafe-inline'",
  );
});

test('sanitizeResponseHeaders is a no-op when no frame headers are present', () => {
  const out = sanitizeResponseHeaders({ 'content-type': 'text/plain' });
  assert.deepEqual(out, { 'content-type': 'text/plain' });
});
