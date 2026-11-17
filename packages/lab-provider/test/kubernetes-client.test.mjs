import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { KubernetesClient } from '../dist/index.js';

/**
 * Records the paths the client sends so tests can assert the API group and
 * plural it derives from each kind. Answers every request so the client's own
 * status handling is exercised too.
 */
async function withServer(fn) {
  const seen = [];
  const server = createServer((req, res) => {
    seen.push({ method: req.method, path: req.url });
    // GET reports "absent" so apply() takes its create path; every write is
    // accepted. `get()` treats a 404 as null.
    if (req.method === 'GET') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end('null');
      return;
    }
    res.writeHead(req.method === 'POST' ? 201 : 200, { 'content-type': 'application/json' });
    res.end('{}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    await fn(new KubernetesClient({ serverUrl: `http://127.0.0.1:${port}` }), seen);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('a Deployment is addressed under apps/v1 as deployments', async () => {
  await withServer(async (client, seen) => {
    await client.apply({
      apiVersion: 'apps/v1',
      kind: 'Deployment',
      metadata: { name: 'ws', namespace: 'lab-1' },
    });
    await client.get('Deployment', 'ws', 'lab-1');
    await client.delete('Deployment', 'ws', 'lab-1');

    assert.deepEqual(
      seen.map((s) => `${s.method} ${s.path}`),
      [
        'GET /apis/apps/v1/namespaces/lab-1/deployments/ws',
        'POST /apis/apps/v1/namespaces/lab-1/deployments',
        'GET /apis/apps/v1/namespaces/lab-1/deployments/ws',
        'DELETE /apis/apps/v1/namespaces/lab-1/deployments/ws',
      ],
    );
  });
});

test('core and other grouped kinds keep their API groups', async () => {
  await withServer(async (client, seen) => {
    await client.apply({
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: { name: 'code-server', namespace: 'lab-1' },
    });
    await client.apply({
      apiVersion: 'networking.k8s.io/v1',
      kind: 'Ingress',
      metadata: { name: 'ide', namespace: 'lab-1' },
    });
    await client.apply({
      apiVersion: 'batch/v1',
      kind: 'Job',
      metadata: { name: 'read', namespace: 'lab-1' },
    });

    const posts = seen.filter((s) => s.method === 'POST').map((s) => s.path);
    assert.deepEqual(posts, [
      '/api/v1/namespaces/lab-1/pods',
      '/apis/networking.k8s.io/v1/namespaces/lab-1/ingresses',
      '/apis/batch/v1/namespaces/lab-1/jobs',
    ]);
  });
});

test('an unknown kind is rejected rather than sent to a wrong path', async () => {
  await withServer(async (client) => {
    await assert.rejects(
      () =>
        client.apply({
          apiVersion: 'apps/v1',
          kind: 'StatefulSet',
          metadata: { name: 'x', namespace: 'lab-1' },
        }),
      /does not know how to address kind "StatefulSet"/,
    );
  });
});
