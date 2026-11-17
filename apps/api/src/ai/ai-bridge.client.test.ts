import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AiBridgeClient, AiBridgeError } from './ai-bridge.client';

/** Capture the request and return a canned JSON response. */
function fakeFetch(body: unknown, init: { status?: number } = {}) {
  const calls: Array<{ url: string; body: unknown }> = [];
  const fetchImpl = (async (url: string, opts: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(opts.body)) });
    return {
      ok: (init.status ?? 200) < 400,
      status: init.status ?? 200,
      json: async () => body,
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

test('suggestProjectCopy maps the snake_case reply to camelCase', async () => {
  const { fetchImpl, calls } = fakeFetch({
    title: 'Task API — Spring Boot',
    description: 'A backend built with Spring Boot.',
    based_on: ['2 stacks'],
  });
  const client = new AiBridgeClient({ baseUrl: 'http://ai:8000', fetchImpl });

  const suggestion = await client.suggestProjectCopy({
    hint: 'task api',
    stacks: ['spring-boot', 'mongodb'],
    componentTitles: ['API'],
  });

  const call = calls[0]!;
  assert.equal(call.url, 'http://ai:8000/v1/copy/suggest');
  assert.deepEqual(call.body, {
    hint: 'task api',
    stacks: ['spring-boot', 'mongodb'],
    component_titles: ['API'],
  });
  assert.equal(suggestion.title, 'Task API — Spring Boot');
  assert.deepEqual(suggestion.basedOn, ['2 stacks']);
});

test('suggestProjectCopy defaults missing fields instead of throwing', async () => {
  const { fetchImpl } = fakeFetch({});
  const client = new AiBridgeClient({ baseUrl: 'http://ai:8000', fetchImpl });

  const suggestion = await client.suggestProjectCopy({
    stacks: [],
    componentTitles: [],
  });

  assert.equal(suggestion.title, '');
  assert.equal(suggestion.description, '');
  assert.deepEqual(suggestion.basedOn, []);
});

test('suggestProjectCopy throws AiBridgeError on a rejected request', async () => {
  const { fetchImpl } = fakeFetch({ detail: 'nope' }, { status: 500 });
  const client = new AiBridgeClient({ baseUrl: 'http://ai:8000', fetchImpl });

  await assert.rejects(
    () => client.suggestProjectCopy({ stacks: [], componentTitles: [] }),
    (err: unknown) => err instanceof AiBridgeError && err.status === 500,
  );
});

test('compareSubmissions maps the snake_case cohort reply to camelCase', async () => {
  const { fetchImpl, calls } = fakeFetch({
    scored_at: '2026-11-11T09:04:00Z',
    results: [
      {
        student_id: 'u1',
        max_similarity: 0.93,
        flagged: true,
        matches: [{ student_id: 'u2', similarity: 0.93 }],
      },
      { student_id: 'u2', max_similarity: 0, flagged: false, matches: [] },
    ],
  });
  const client = new AiBridgeClient({ baseUrl: 'http://ai:8000', fetchImpl });

  const reports = await client.compareSubmissions({
    tenantId: 't1',
    exerciseId: 'k8s-quiz-1:q-mean',
    submissions: [
      { studentId: 'u1', code: 'print(1)' },
      { studentId: 'u2', code: 'print(1)' },
    ],
    threshold: 0.85,
  });

  const call = calls[0]!;
  assert.equal(call.url, 'http://ai:8000/v1/plagiarism/score');
  assert.deepEqual(call.body, {
    tenant_id: 't1',
    exercise_id: 'k8s-quiz-1:q-mean',
    submissions: [
      { student_id: 'u1', code: 'print(1)' },
      { student_id: 'u2', code: 'print(1)' },
    ],
    threshold: 0.85,
  });
  assert.equal(reports.length, 2);
  assert.equal(reports[0]!.studentId, 'u1');
  assert.equal(reports[0]!.maxSimilarity, 0.93);
  assert.equal(reports[0]!.flagged, true);
  assert.deepEqual(reports[0]!.matches, [{ studentId: 'u2', similarity: 0.93 }]);
});

test('compareSubmissions clamps a stray ratio and tolerates a missing list', async () => {
  const { fetchImpl } = fakeFetch({
    results: [{ student_id: 'u1', max_similarity: 5, flagged: true }],
  });
  const client = new AiBridgeClient({ baseUrl: 'http://ai:8000', fetchImpl });

  const reports = await client.compareSubmissions({
    tenantId: 't1',
    exerciseId: 'x',
    submissions: [{ studentId: 'u1', code: 'a' }],
  });

  assert.equal(reports[0]!.maxSimilarity, 1);
  assert.deepEqual(reports[0]!.matches, []);
});

test('compareSubmissions throws AiBridgeError when the AI plane rejects', async () => {
  const { fetchImpl } = fakeFetch({ detail: 'nope' }, { status: 503 });
  const client = new AiBridgeClient({ baseUrl: 'http://ai:8000', fetchImpl });

  await assert.rejects(
    () =>
      client.compareSubmissions({
        tenantId: 't1',
        exerciseId: 'x',
        submissions: [{ studentId: 'u1', code: 'a' }],
      }),
    (err: unknown) => err instanceof AiBridgeError && err.status === 503,
  );
});
