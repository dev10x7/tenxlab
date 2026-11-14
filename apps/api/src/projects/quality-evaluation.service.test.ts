import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  QualityEvaluationService,
  parseReport,
  autoFieldsFrom,
} from './quality-evaluation.service';
import type { QualityAnalyzer, QualityReport } from '../ai/ai-bridge.client';
import type { WorkspaceFile, WorkspaceReader } from '@tenxlab/lab-provider';
import {
  InMemoryProjectWorkspaceRepository,
  InMemoryQualityEvaluationRepository,
} from '../common/in-memory';

const REPORT: QualityReport = {
  score: 82,
  issueCount: 1,
  issues: [{ code: 'no-unused-vars', message: 'unused variable x', line: 3 }],
};

/** A reader that returns a fixed file set, recording the input it received. */
function fakeReader(files: WorkspaceFile[]): WorkspaceReader & { lastInput?: unknown } {
  const reader: WorkspaceReader & { lastInput?: unknown } = {
    name: 'fake',
    async readWorkspaceFiles(input) {
      reader.lastInput = input;
      return files;
    },
  };
  return reader;
}

function fakeAnalyzer(report: QualityReport = REPORT): QualityAnalyzer & { lastCode?: string } {
  const analyzer: QualityAnalyzer & { lastCode?: string } = {
    async scoreQuality(input) {
      analyzer.lastCode = input.code;
      return report;
    },
  };
  return analyzer;
}

async function fixture(
  overrides: {
    status?: string;
    reader?: WorkspaceReader | null;
    analyzer?: QualityAnalyzer | null;
  } = {},
) {
  const workspaces = new InMemoryProjectWorkspaceRepository();
  const evaluations = new InMemoryQualityEvaluationRepository();
  const reader = overrides.reader === undefined ? fakeReader([{ path: 'src/app.py', content: 'print(1)' }]) : overrides.reader;
  const analyzer = overrides.analyzer === undefined ? fakeAnalyzer() : overrides.analyzer;
  const svc = new QualityEvaluationService({ workspaces, evaluations, reader, analyzer });
  const workspace = await workspaces.create({
    tenantId: 't1',
    userId: 'u1',
    templateSlug: 'spring-boot',
    runtimeTier: 'tier_2_container',
    status: overrides.status ?? 'running',
    ideUrl: null,
    storageRef: 'vol-1',
  });
  return { svc, workspaces, evaluations, workspace, reader, analyzer };
}

test('analyze reads the workspace, scores it, and caches the result', async () => {
  const { svc, workspaces, workspace, reader } = await fixture();
  const result = await svc.analyze('u1', workspace.id, { projectId: 'p1', componentId: 'c1' });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.evaluation.score, 82);
  assert.equal(result.evaluation.issueCount, 1);
  assert.equal(result.evaluation.status, 'succeeded');
  assert.deepEqual(parseReport(result.evaluation.report), REPORT);
  // The reader is asked only for the workspace's own session.
  const seen = reader as unknown as { lastInput?: { sessionId: string } };
  assert.deepEqual(seen.lastInput?.sessionId, workspace.id);
  const cached = await workspaces.findById(workspace.id);
  assert.equal(cached?.qualityScore, 82);
  assert.notEqual(cached?.analyzedAt, null);
});

test('analyze passes the concatenated source to the analyzer', async () => {
  const reader = fakeReader([
    { path: 'src/app.py', content: 'print(1)' },
    { path: 'src/util.py', content: 'x = 1' },
  ]);
  const analyzer = fakeAnalyzer();
  const { svc, workspace } = await fixture({ reader, analyzer });
  await svc.analyze('u1', workspace.id);
  assert.match(analyzer.lastCode ?? '', /src\/app\.py/);
  assert.match(analyzer.lastCode ?? '', /x = 1/);
});

test('analyze rejects a workspace owned by another user', async () => {
  const { svc, workspace } = await fixture();
  const result = await svc.analyze('someone-else', workspace.id);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'workspace_not_found');
});

test('analyze requires a running workspace', async () => {
  const { svc, workspace } = await fixture({ status: 'stopped' });
  const result = await svc.analyze('u1', workspace.id);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'workspace_not_running');
});

test('analyze reports unavailable when no reader or analyzer is configured', async () => {
  const { svc, workspace } = await fixture({ analyzer: null });
  const result = await svc.analyze('u1', workspace.id);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'analysis_unavailable');
});

test('a reader failure is recorded as a failed evaluation, not thrown', async () => {
  const reader: WorkspaceReader = {
    name: 'boom',
    async readWorkspaceFiles() {
      throw new Error('pod is gone');
    },
  };
  const { svc, evaluations, workspace } = await fixture({ reader });
  const result = await svc.analyze('u1', workspace.id);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'analysis_failed');
  assert.equal(result.message, 'pod is gone');
  const history = await evaluations.listByWorkspace(workspace.id);
  assert.equal(history.length, 1);
  assert.equal(history[0]?.status, 'failed');
  assert.equal(history[0]?.error, 'pod is gone');
});

test('history is newest first and latest returns the most recent run', async () => {
  const { svc, workspace } = await fixture();
  await svc.analyze('u1', workspace.id);
  await new Promise((r) => setTimeout(r, 5));
  await svc.analyze('u1', workspace.id);
  const history = await svc.history('u1', workspace.id);
  assert.equal(history.length, 2);
  const latest = await svc.latest('u1', workspace.id);
  assert.equal(latest?.id, history[0]?.id);
});

test('history and latest reject a workspace owned by another user', async () => {
  const { svc, workspace } = await fixture();
  await svc.analyze('u1', workspace.id);
  await assert.rejects(() => svc.history('someone-else', workspace.id), /Workspace not found/);
  assert.equal(await svc.latest('someone-else', workspace.id), null);
});

test('parseReport tolerates null and malformed payloads', () => {
  assert.equal(parseReport(null), null);
  assert.equal(parseReport('not json'), null);
  assert.deepEqual(parseReport(JSON.stringify(REPORT)), REPORT);
});

test('autoFieldsFrom copies the workspace auto-evaluation onto a submission', () => {
  const when = new Date('2026-01-02T00:00:00Z');
  const fields = autoFieldsFrom({
    qualityScore: 77,
    qualityReport: '{"score":77}',
    analyzedAt: when,
  } as never);
  assert.deepEqual(fields, {
    autoScore: 77,
    autoReport: '{"score":77}',
    autoEvaluatedAt: when,
  });
});
