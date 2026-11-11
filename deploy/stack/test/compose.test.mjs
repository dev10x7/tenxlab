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

test('api and web expose the ports the docs promise', () => {
  assert.match(svc.get('api').join('\n'), /'4000:4000'/);
  assert.match(svc.get('web').join('\n'), /'3000:3000'/);
});
