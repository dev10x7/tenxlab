import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InMemorySupportIssueRepository } from '../common/in-memory';
import {
  SupportService,
  SUPPORT_CATEGORIES,
  SUPPORT_DESCRIPTION_MAX,
} from './support.service';

function fixture() {
  return new SupportService(new InMemorySupportIssueRepository());
}

test('a well-formed report is stored and returned as a DTO', async () => {
  const service = fixture();
  const result = await service.create({
    tenantId: 'tenant-1',
    userId: 'u1',
    category: 'bug',
    title: '  Run button does nothing  ',
    description: '  I pressed Run and nothing happened.  ',
    pageUrl: '/editor',
  });
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.issue.title, 'Run button does nothing');
  assert.equal(result.issue.description, 'I pressed Run and nothing happened.');
  assert.equal(result.issue.category, 'bug');
  assert.equal(result.issue.status, 'open');
  assert.equal(result.issue.pageUrl, '/editor');
});

test('category defaults to other when omitted', async () => {
  const service = fixture();
  const result = await service.create({
    tenantId: 'tenant-1',
    userId: 'u1',
    title: 'Question',
    description: 'How do I reset my password?',
  });
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.issue.category, 'other');
});

test('every advertised category is accepted', async () => {
  const service = fixture();
  for (const category of SUPPORT_CATEGORIES) {
    const result = await service.create({
      tenantId: 'tenant-1',
      userId: 'u1',
      category,
      title: 'T',
      description: 'D',
    });
    assert.ok(result.ok, `category ${category} should be accepted`);
  }
});

test('an unknown category is rejected', async () => {
  const service = fixture();
  const result = await service.create({
    tenantId: 'tenant-1',
    userId: 'u1',
    category: 'exploit',
    title: 'T',
    description: 'D',
  });
  assert.ok(!result.ok);
  assert.equal(result.reason, 'invalid_category');
});

test('title and description are required', async () => {
  const service = fixture();
  const noTitle = await service.create({
    tenantId: 'tenant-1',
    userId: 'u1',
    title: '   ',
    description: 'D',
  });
  assert.ok(!noTitle.ok);
  assert.equal(noTitle.reason, 'title_required');

  const noDescription = await service.create({
    tenantId: 'tenant-1',
    userId: 'u1',
    title: 'T',
    description: '',
  });
  assert.ok(!noDescription.ok);
  assert.equal(noDescription.reason, 'description_required');
});

test('an over-long description is rejected', async () => {
  const service = fixture();
  const result = await service.create({
    tenantId: 'tenant-1',
    userId: 'u1',
    title: 'T',
    description: 'x'.repeat(SUPPORT_DESCRIPTION_MAX + 1),
  });
  assert.ok(!result.ok);
  assert.equal(result.reason, 'too_long');
});

test('the queue is tenant-scoped and newest first', async () => {
  const service = fixture();
  await service.create({ tenantId: 'tenant-1', userId: 'u1', title: 'A', description: 'D' });
  await service.create({ tenantId: 'tenant-2', userId: 'u2', title: 'B', description: 'D' });
  const later = await service.create({
    tenantId: 'tenant-1',
    userId: 'u1',
    title: 'C',
    description: 'D',
  });
  assert.ok(later.ok);

  const queue = await service.list('tenant-1');
  assert.equal(queue.length, 2);
  assert.equal(queue[0]!.title, 'C');
  assert.ok(queue.every((i) => i.title !== 'B'));
});

test('status can be moved through the queue, but not across tenants', async () => {
  const service = fixture();
  const created = await service.create({
    tenantId: 'tenant-1',
    userId: 'u1',
    title: 'A',
    description: 'D',
  });
  assert.ok(created.ok);
  if (!created.ok) return;

  const resolved = await service.setStatus(created.issue.id, 'tenant-1', 'resolved');
  assert.ok(resolved.ok);
  if (!resolved.ok) return;
  assert.equal(resolved.issue.status, 'resolved');

  const crossTenant = await service.setStatus(created.issue.id, 'tenant-2', 'open');
  assert.ok(!crossTenant.ok);
  assert.equal(crossTenant.reason, 'not_found');

  const badStatus = await service.setStatus(created.issue.id, 'tenant-1', 'closed');
  assert.ok(!badStatus.ok);
  assert.equal(badStatus.reason, 'invalid_status');
});
