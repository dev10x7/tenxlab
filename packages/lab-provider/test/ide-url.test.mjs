import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeIdeUrl } from '../dist/index.js';

test('composeIdeUrl emits the ingress host directly when no base is set', () => {
  assert.equal(
    composeIdeUrl('kubelab-lab1-ex1-u1.192.168.49.2.nip.io'),
    'https://kubelab-lab1-ex1-u1.192.168.49.2.nip.io/',
  );
});

test('composeIdeUrl honours an explicit http scheme', () => {
  assert.equal(
    composeIdeUrl('lab.internal', { ideScheme: 'http' }),
    'http://lab.internal/',
  );
});

test('composeIdeUrl routes through the public gateway when one is configured', () => {
  assert.equal(
    composeIdeUrl('kubelab-lab1-ex1-u1.192.168.49.2.nip.io', {
      publicIdeBaseUrl: 'https://labs.example.com',
    }),
    'https://labs.example.com/lab/kubelab-lab1-ex1-u1.192.168.49.2.nip.io/',
  );
});

test('composeIdeUrl tolerates a trailing slash on the public base', () => {
  assert.equal(
    composeIdeUrl('lab.example.com', { publicIdeBaseUrl: 'https://labs.example.com/' }),
    'https://labs.example.com/lab/lab.example.com/',
  );
});

test('composeIdeUrl derives a fresh URL from a host, so a base change applies', () => {
  const host = 'kubelab-lab1-ex1-u1.192.168.49.2.nip.io';
  const before = composeIdeUrl(host, { publicIdeBaseUrl: 'https://old.example.com' });
  const after = composeIdeUrl(host, { publicIdeBaseUrl: 'https://new.example.com' });
  assert.equal(before, 'https://old.example.com/lab/' + host + '/');
  assert.equal(after, 'https://new.example.com/lab/' + host + '/');
});

test('composeIdeUrl returns null when there is no host', () => {
  assert.equal(composeIdeUrl(null), null);
  assert.equal(composeIdeUrl(undefined, { publicIdeBaseUrl: 'https://labs.example.com' }), null);
  assert.equal(composeIdeUrl(''), null);
});
