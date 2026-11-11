import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LabSpec } from '@tenxlab/contracts';
import { KubeLabAdapter } from '../dist/index.js';

/**
 * In-memory fake of KubeLab's PocketBase API. Enough of the surface for the
 * adapter: admin auth, collection list/create/read/update, plus a hook that
 * emulates the Go backend rejecting `agentRunning=true` until the cluster is up.
 */
function fakeKubeLab(options = {}) {
  const store = { users: {}, labs: {}, exercises: {}, lab_sessions: {}, exercise_sessions: {} };
  const calls = [];
  let seq = 0;
  let agentAccepts = options.agentAcceptsAfter ?? 0;
  let ideStatus = options.ideStatus ?? 200;

  const nextId = (prefix) => `${prefix}${++seq}`;

  const impl = async (url, init) => {
    const method = init?.method ?? 'GET';
    const path = url.replace('http://kl.local', '');
    calls.push({ url, method, headers: init?.headers, body: init?.body });

    // IDE readiness probe (absolute host, not the API).
    if (!path.startsWith('/api/')) {
      return jsonResponse(ideStatus, {});
    }

    if (path === '/api/admins/auth-with-password') {
      return jsonResponse(200, { token: 'admin-token' });
    }

    const listMatch = path.match(/^\/api\/collections\/([^/]+)\/records\?/);
    if (listMatch && method === 'GET') {
      const collection = listMatch[1];
      const filter = decodeURIComponent(
        new URLSearchParams(path.split('?')[1]).get('filter') ?? '',
      );
      const rows = Object.values(store[collection]).filter((row) => matches(row, filter));
      return jsonResponse(200, { items: rows.slice(0, 1) });
    }

    const createMatch = path.match(/^\/api\/collections\/([^/]+)\/records$/);
    if (createMatch && method === 'POST') {
      const collection = createMatch[1];
      const data = JSON.parse(init.body);
      const row = { id: nextId(collection.slice(0, 2)), ...data };
      store[collection][row.id] = row;
      return jsonResponse(200, row);
    }

    const itemMatch = path.match(/^\/api\/collections\/([^/]+)\/records\/([^/]+)$/);
    if (itemMatch) {
      const [, collection, id] = itemMatch;
      const row = store[collection][id];
      if (method === 'GET') {
        return row ? jsonResponse(200, row) : jsonResponse(404, {});
      }
      if (method === 'PATCH') {
        if (!row) return jsonResponse(404, {});
        const patch = JSON.parse(init.body);
        // Emulate the Go hook: the exercise session cannot start until the
        // vcluster pod is up.
        if (
          collection === 'exercise_sessions' &&
          patch.agentRunning === true &&
          agentAccepts > 0
        ) {
          agentAccepts -= 1;
          return jsonResponse(400, { message: 'vcluster not ready' });
        }
        Object.assign(row, patch);
        return jsonResponse(200, row);
      }
    }

    return jsonResponse(404, {});
  };

  return { impl, calls, store, setIdeStatus: (s) => (ideStatus = s) };
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function matches(row, filter) {
  // Filter is "a='x' && b='y'".
  return filter.split('&&').every((clause) => {
    const m = clause.trim().match(/^(\w+)='(.*)'$/);
    if (!m) return true;
    return String(row[m[1]] ?? '') === m[2];
  });
}

function makeAdapter(fake, overrides = {}) {
  return new KubeLabAdapter({
    baseUrl: 'http://kl.local',
    adminEmail: 'admin@tenxlab.local',
    adminPassword: 'secret',
    allowedHosts: '192.168.49.2.nip.io',
    resolveExercise: () => ({
      labSlug: 'kubernetes-foundations',
      labTitle: 'Kubernetes Foundations',
      exerciseTitle: 'Create a Pod',
      bootstrapUrl: 'http://assets/bootstrap.sh',
      checkUrl: 'http://assets/check.sh',
    }),
    resolveUser: (id) => ({ email: `${id}@tenxlab.local`, name: 'Demo Student' }),
    fetchImpl: fake.impl,
    readinessPollMs: 1,
    readinessTimeoutMs: 2000,
    ...overrides,
  });
}

const spec = LabSpec.parse({
  exercise_id: 'create-simple-pod',
  runtime_tier: 'tier_3_vcluster',
  tenant_id: 't1',
  user_id: 'u1',
  session_id: 'sess-1',
});

test('ideUrlFor builds the code-server ingress host', () => {
  const adapter = makeAdapter(fakeKubeLab());
  assert.equal(
    adapter.ideUrlFor('lab1', 'ex1', 'user1'),
    'https://kubelab-lab1-ex1-user1.192.168.49.2.nip.io/',
  );
});

test('provision authenticates as admin, ensures records, and returns a handle', async () => {
  const fake = fakeKubeLab();
  const adapter = makeAdapter(fake);
  const handle = await adapter.provision(spec);

  assert.equal(handle.status, 'ACTIVE');
  assert.equal(handle.tier, 'tier_3_vcluster');
  assert.match(handle.ide_url, /^https:\/\/kubelab-.*\.192\.168\.49\.2\.nip\.io\/$/);
  assert.equal(handle.session_id, 'sess-1');

  // Admin auth happens once and its token is reused.
  const authCalls = fake.calls.filter((c) => c.url.includes('/api/admins/auth-with-password'));
  assert.equal(authCalls.length, 1);
  assert.equal(
    fake.calls.find((c) => c.url.includes('/api/collections/users/records?')).headers
      .authorization,
    'admin-token',
  );

  // The vcluster and the agent were both switched on.
  const labPatch = fake.calls.find(
    (c) => c.method === 'PATCH' && c.url.includes('/lab_sessions/'),
  );
  assert.equal(JSON.parse(labPatch.body).clusterRunning, true);
  const exercisePatch = fake.calls.find(
    (c) => c.method === 'PATCH' && c.url.includes('/exercise_sessions/'),
  );
  assert.equal(JSON.parse(exercisePatch.body).agentRunning, true);
});

test('provision retries the agent start until the cluster accepts it', async () => {
  const fake = fakeKubeLab({ agentAcceptsAfter: 2 });
  const adapter = makeAdapter(fake);
  const handle = await adapter.provision(spec);
  assert.equal(handle.status, 'ACTIVE');
  const agentPatches = fake.calls.filter(
    (c) => c.method === 'PATCH' && c.url.includes('/exercise_sessions/'),
  );
  assert.equal(agentPatches.length, 3); // two 400s, then success
});

test('provision returns WARM when the IDE never becomes reachable', async () => {
  const fake = fakeKubeLab({ ideStatus: 503 });
  const adapter = makeAdapter(fake, { readinessTimeoutMs: 30 });
  const handle = await adapter.provision(spec);
  assert.equal(handle.status, 'WARM');
});

test('provision refuses a non-vcluster tier', async () => {
  const adapter = makeAdapter(fakeKubeLab());
  await assert.rejects(
    () => adapter.provision({ ...spec, runtime_tier: 'tier_2_container' }),
    (err) => err.name === 'LabProviderError' && err.status === 400,
  );
});

test('status reads the exercise session and reports ACTIVE', async () => {
  const fake = fakeKubeLab();
  const adapter = makeAdapter(fake);
  fake.store.exercise_sessions.es1 = {
    id: 'es1',
    user: 'u1',
    exercise: 'ex1',
    agentRunning: true,
    startTime: '2026-11-11 10:00:00.000Z',
    updated: '2026-11-11 10:05:00.000Z',
  };
  fake.store.exercises.ex1 = { id: 'ex1', lab: 'lab1' };
  const handle = await adapter.status('es1');
  assert.equal(handle.status, 'ACTIVE');
  assert.match(handle.ide_url, /kubelab-lab1-ex1-u1\./);
});

test('status returns null for an unknown session', async () => {
  const adapter = makeAdapter(fakeKubeLab());
  assert.equal(await adapter.status('missing'), null);
});

test('terminate switches the agent and the cluster off', async () => {
  const fake = fakeKubeLab();
  const adapter = makeAdapter(fake);
  fake.store.exercise_sessions.es1 = {
    id: 'es1',
    user: 'u1',
    exercise: 'ex1',
    agentRunning: true,
  };
  fake.store.exercises.ex1 = { id: 'ex1', lab: 'lab1' };
  fake.store.lab_sessions.ls1 = { id: 'ls1', user: 'u1', lab: 'lab1', clusterRunning: true };

  await adapter.terminate('es1');
  assert.equal(fake.store.exercise_sessions.es1.agentRunning, false);
  assert.equal(fake.store.lab_sessions.ls1.clusterRunning, false);
});

test('provision does not re-fire the cluster start when it is already running', async () => {
  const fake = fakeKubeLab();
  const adapter = makeAdapter(fake);
  // Seed an already-running session so the hook must be skipped.
  fake.store.users.u1 = { id: 'u1', email: 'u1@tenxlab.local', role: 'user' };
  fake.store.labs.lab1 = { id: 'lab1', title: 'Kubernetes Foundations' };
  fake.store.exercises.ex1 = { id: 'ex1', lab: 'lab1', title: 'Create a Pod' };
  fake.store.lab_sessions.ls1 = { id: 'ls1', user: 'u1', lab: 'lab1', clusterRunning: true };
  fake.store.exercise_sessions.es1 = {
    id: 'es1',
    user: 'u1',
    exercise: 'ex1',
    agentRunning: true,
  };

  const handle = await adapter.provision(spec);
  assert.equal(handle.status, 'ACTIVE');
  const labPatches = fake.calls.filter(
    (c) => c.method === 'PATCH' && c.url.includes('/lab_sessions/'),
  );
  assert.equal(labPatches.length, 0);
  const agentPatches = fake.calls.filter(
    (c) => c.method === 'PATCH' && c.url.includes('/exercise_sessions/'),
  );
  assert.equal(agentPatches.length, 0);
});

test('admin auth failure raises LabProviderError', async () => {
  const fake = fakeKubeLab();
  const failing = {
    impl: async (url, init) => {
      if (url.includes('auth-with-password')) return jsonResponse(400, { message: 'bad' });
      return fake.impl(url, init);
    },
  };
  const adapter = makeAdapter(failing);
  await assert.rejects(
    () => adapter.provision(spec),
    (err) => err.name === 'LabProviderError' && err.status === 400,
  );
});
