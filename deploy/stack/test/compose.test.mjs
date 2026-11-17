import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * Static checks on the full-stack compose file. These guard the wiring that is
 * easy to break by hand (service names, dependency conditions, health-gated
 * startup, the API's Postgres URL) without needing a Docker daemon in CI.
 *
 * `docker compose config` is the authoritative validator; this file catches the
 * regressions a reviewer would miss.
 */

const here = dirname(fileURLToPath(import.meta.url));
const composePath = resolve(here, '../../../docker-compose.yml');
const raw = readFileSync(composePath, 'utf8');

/** Parse only what the assertions need: top-level service names and a body. */
function services() {
  const lines = raw.split('\n');
  const out = new Map();
  let current = null;
  for (const line of lines) {
    const svc = line.match(/^  ([a-z0-9-]+):\s*$/);
    if (svc) {
      current = svc[1];
      out.set(current, []);
      continue;
    }
    if (current) out.get(current).push(line);
  }
  return out;
}

const svc = services();

test('compose defines the core stack', () => {
  for (const name of ['postgres', 'redis', 'api', 'web', 'ai']) {
    assert.ok(svc.has(name), `missing service: ${name}`);
  }
});

test('object storage is opt-in via the storage profile', () => {
  assert.ok(svc.has('minio'), 'missing minio service');
  const body = svc.get('minio').join('\n');
  assert.match(body, /profiles:\s*\['storage'\]/);
});

test('api waits for a healthy database and sets a Postgres URL', () => {
  const body = svc.get('api').join('\n');
  assert.match(body, /condition:\s*service_healthy/);
  assert.match(body, /DATABASE_URL:\s*postgresql:\/\/[^@]+@postgres:5432\/tenxlab/);
  assert.match(body, /USE_DATABASE:\s*'true'/);
});

test('web waits for a healthy api and proxies to it server-side', () => {
  const body = svc.get('web').join('\n');
  assert.match(body, /condition:\s*service_healthy/);
  assert.match(body, /API_BASE_URL:\s*http:\/\/api:4000/);
});

test('every long-running service declares a healthcheck', () => {
  for (const name of ['postgres', 'redis', 'api', 'ai']) {
    const body = svc.get(name).join('\n');
    assert.match(body, /healthcheck:/, `${name} has no healthcheck`);
  }
});

test('the warm-pool operator is opt-in and points at the shared database', () => {
  assert.ok(svc.has('lab-operator'), 'missing lab-operator service');
  const body = svc.get('lab-operator').join('\n');
  assert.match(body, /profiles:\s*\['operator'\]/);
  assert.match(
    body,
    /LAB_OPERATOR_DATABASE_URL:\s*postgresql:\/\/[^@]+@postgres:5432\/tenxlab/,
  );
});

test('api and web expose the ports the docs promise', () => {
  assert.match(svc.get('api').join('\n'), /'4000:4000'/);
  assert.match(svc.get('web').join('\n'), /'3000:3000'/);
});

test('api points auto-evaluation at the ai service', () => {
  const body = svc.get('api').join('\n');
  assert.match(body, /AI_PLANE_URL:\s*http:\/\/ai:8000/);
});

test('the tier-1 runner is part of the default stack', () => {
  assert.ok(svc.has('piston'), 'missing piston service');
  const body = svc.get('piston').join('\n');
  assert.doesNotMatch(body, /profiles:/, 'piston must run by default');
  assert.match(body, /healthcheck:/);
  assert.match(svc.get('api').join('\n'), /PISTON_ENABLED:\s*'true'/);
  assert.match(svc.get('api').join('\n'), /PISTON_BASE_URL:\s*http:\/\/piston:2000/);
});

test('piston-init installs the editor runtimes after piston is healthy', () => {
  assert.ok(svc.has('piston-init'), 'missing piston-init service');
  const body = svc.get('piston-init').join('\n');
  assert.match(body, /condition:\s*service_healthy/);
  assert.match(body, /\/api\/v2/);
  assert.match(body, /\/packages/);
  // Package names, not runtime aliases: node runs javascript, gcc runs c/c++.
  for (const pkg of ['python', 'node', 'typescript', 'java', 'gcc', 'mono']) {
    assert.match(body, new RegExp(`\\b${pkg}:`), `missing package: ${pkg}`);
  }
});

test('the default network pins an MTU for container egress', () => {
  // A user-defined network defaults to MTU 1500, which black-holes large TLS
  // records when the host path MTU is lower (Piston's GitHub downloads hang).
  assert.match(raw, /networks:\s*\n\s*default:/);
  assert.match(raw, /com\.docker\.network\.driver\.mtu/);
});

test('k8s-up bootstraps the execution plane before the api starts', () => {
  assert.ok(svc.has('k8s-up'), 'missing k8s-up service');
  const body = svc.get('k8s-up').join('\n');
  // It is a one-shot bootstrap, not a long-running workload.
  assert.match(body, /restart:\s*'no'/);
  assert.match(body, /\/var\/run\/docker\.sock:\/var\/run\/docker\.sock/);
  assert.match(body, /kubeconfig:\/kubeconfig/);
  // The api must not start until the cluster and kubeconfig exist.
  assert.match(
    svc.get('api').join('\n'),
    /k8s-up:\s*\n\s*condition:\s*service_completed_successfully/,
  );
});

test('the kind node lands on a fixed address by construction', () => {
  // The node must be the labs network's only dynamic member: a fixed subnet
  // with every other service pinned to a static address leaves it the first
  // (`.2`) allocation. Re-pinning after creation breaks the control plane.
  const body = svc.get('k8s-up').join('\n');
  assert.match(body, /ipv4_address:\s*\$\{LAB_K8SUP_IP:-192\.168\.240\.3\}/);
  assert.match(body, /LAB_NODE_IP:\s*\$\{LAB_NODE_IP:-192\.168\.240\.2\}/);
  assert.match(raw, /subnet:\s*\$\{LAB_SUBNET:-192\.168\.240\.0\/24\}/);
});

test('the ide-gateway is the single public entry point for lab IDEs', () => {
  assert.ok(svc.has('ide-gateway'), 'missing ide-gateway service');
  const body = svc.get('ide-gateway').join('\n');
  assert.match(body, /'12001:12001'/);
  assert.match(body, /IDE_PROXY_PORT:\s*'12001'/);
  assert.match(body, /ide-gateway\.mjs/);
  // It must reach the ingress hosts, so it joins `labs`; the api advertises it.
  assert.match(body, /labs:/);
  assert.match(
    svc.get('api').join('\n'),
    /KUBELAB_IDE_PUBLIC_URL:\s*\$\{KUBELAB_IDE_PUBLIC_URL:-http:\/\/localhost:12001\}/,
  );
});

test('the labs network pins an MTU and a static subnet', () => {
  const block = raw.slice(raw.indexOf('\n  labs:'));
  assert.match(block, /com\.docker\.network\.driver\.mtu/);
  assert.match(block, /gateway:\s*\$\{LAB_GATEWAY:-192\.168\.240\.1\}/);
});

test('the api enables the tier-2 provider and forks out of the box', () => {
  const body = svc.get('api').join('\n');
  assert.match(body, /KUBELAB_ENABLED:\s*'true'/);
  assert.match(body, /POD_PROVIDER_ENABLED:\s*'true'/);
  // PROJECTS_ENABLED gates the FORK_PROVIDER; without it a fork is a silent no-op.
  assert.match(body, /PROJECTS_ENABLED:\s*'true'/);
  assert.match(body, /KUBECONFIG:\s*\/kubeconfig\/config/);
  // The api reaches the node over `labs`, not only the default network.
  assert.match(body, /networks:\s*\n\s*default:\s*\{\}/);
  assert.match(body, /labs:\s*\n\s*ipv4_address:/);
});
