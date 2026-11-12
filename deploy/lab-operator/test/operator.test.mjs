import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * Static checks on the warm-pool operator's Kubernetes manifests. These guard
 * the RBAC and pool-sizing wiring a reviewer would otherwise have to diff by
 * eye; they do not need a cluster.
 */

const here = dirname(fileURLToPath(import.meta.url));
const raw = readFileSync(resolve(here, '../operator.yaml'), 'utf8');

const docs = raw
  .split(/^---$/m)
  .map((d) => d.trim())
  .filter(Boolean)
  .map((d) => {
    const kind = d.match(/^kind:\s*(\S+)/m)?.[1];
    const name = d.match(/^\s*name:\s*(\S+)/m)?.[1];
    return { kind, name, body: d };
  });

function byKind(kind) {
  const doc = docs.find((d) => d.kind === kind);
  assert.ok(doc, `missing ${kind} manifest`);
  return doc;
}

test('manifests declare a namespace, service account and binding', () => {
  assert.equal(byKind('Namespace').name, 'tenxlab-system');
  const sa = byKind('ServiceAccount');
  assert.equal(sa.name, 'tenxlab-lab-operator');
  assert.match(sa.body, /namespace:\s*tenxlab-system/);
  const binding = byKind('ClusterRoleBinding');
  assert.match(binding.body, /name:\s*tenxlab-lab-operator/);
});

test('the cluster role can manage every object the pod provider applies', () => {
  const role = byKind('ClusterRole');
  for (const resource of ['namespaces', 'pods', 'services', 'persistentvolumeclaims', 'ingresses']) {
    assert.match(role.body, new RegExp(resource), `ClusterRole cannot manage ${resource}`);
  }
  assert.match(role.body, /networking\.k8s\.io/);
});

test('the operator runs as a single replica with the service account', () => {
  const deploy = byKind('Deployment');
  assert.match(deploy.body, /replicas:\s*1/);
  assert.match(deploy.body, /serviceAccountName:\s*tenxlab-lab-operator/);
  assert.match(deploy.body, /image:\s*ghcr\.io\/dev10x7\/tenxlab-lab-operator/);
});

test('the operator gets a database URL and pool sizes from the environment', () => {
  const deploy = byKind('Deployment');
  assert.match(deploy.body, /LAB_OPERATOR_DATABASE_URL/);
  assert.match(deploy.body, /WARM_TIER2/);
  assert.match(deploy.body, /RECONCILE_INTERVAL_MS/);
});
