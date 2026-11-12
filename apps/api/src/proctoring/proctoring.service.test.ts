import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryProctorEventRepository } from '../common/in-memory';
import { isProctorEventType, ProctoringService } from './proctoring.service';

function service() {
  return new ProctoringService(new InMemoryProctorEventRepository());
}

test('isProctorEventType accepts known signals and rejects the rest', () => {
  assert.equal(isProctorEventType('focus_lost'), true);
  assert.equal(isProctorEventType('display_count'), true);
  assert.equal(isProctorEventType('teleport'), false);
  assert.equal(isProctorEventType(undefined), false);
  assert.equal(isProctorEventType(7), false);
});

test('recorded events aggregate into a risk summary', async () => {
  const svc = service();
  await svc.record('a1', 'focus_lost');
  await svc.record('a1', 'copy', 'Ctrl+C in editor');
  await svc.record('a1', 'paste');
  const summary = await svc.summarize('a1');
  assert.equal(summary.eventCount, 3);
  assert.equal(summary.riskScore, 5 + 8 + 12);
  assert.equal(summary.riskLevel, 'medium');
  assert.equal(summary.counts.focus_lost, 1);
});

test('an attempt with no events is low risk', async () => {
  const summary = await service().summarize('nobody');
  assert.equal(summary.eventCount, 0);
  assert.equal(summary.riskLevel, 'low');
});

test('events are isolated per attempt', async () => {
  const svc = service();
  await svc.record('a1', 'vm_detected');
  await svc.record('a2', 'focus_lost');
  assert.equal((await svc.summarize('a1')).riskScore, 30);
  assert.equal((await svc.summarize('a2')).riskScore, 5);
});

test('summarizeMany returns one summary per requested attempt', async () => {
  const svc = service();
  await svc.record('a1', 'copy');
  await svc.record('a2', 'display_count');
  const summaries = await svc.summarizeMany(['a1', 'a2', 'a3']);
  assert.equal(summaries.length, 3);
  assert.equal(summaries[0]!.riskScore, 8);
  assert.equal(summaries[1]!.riskLevel, 'medium');
  assert.equal(summaries[2]!.riskScore, 0);
});
