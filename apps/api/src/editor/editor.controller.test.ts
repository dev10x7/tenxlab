import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Request } from 'express';
import { SessionService } from '../identity/session.service';
import { InMemorySnippetRepository } from '../common/in-memory';
import { EditorService } from './editor.service';
import { EditorController } from '../http/controllers';

const sessions = new SessionService('test-secret');

function cookieFor(userId: string): string {
  const signed = sessions.sign({
    userId,
    tenantId: 'tenant-1',
    role: 'student',
    displayName: 'Test Student',
  });
  return `${sessions.name}=${encodeURIComponent(signed)}`;
}

function req(cookie?: string): Request {
  return { headers: cookie ? { cookie } : {} } as Request;
}

function controller() {
  return new EditorController(
    new EditorService({ snippets: new InMemorySnippetRepository(), runner: null }),
    sessions,
  );
}

test('editor endpoints require a session', async () => {
  await assert.rejects(() => controller().listSnippets(req()), /Sign in required/);
});

test('run requires a language and a source string', async () => {
  const c = controller();
  await assert.rejects(() => c.run({ source: 'x' }, req(cookieFor('u1'))), /language is required/);
  await assert.rejects(() => c.run({ language: 'python' }, req(cookieFor('u1'))), /source is required/);
});

test('run is unavailable when no pool is configured', async () => {
  await assert.rejects(
    () => controller().run({ language: 'python', source: 'x' }, req(cookieFor('u1'))),
    /Code execution is not available/,
  );
});

test('an unknown language is a 400 before the pool is consulted', async () => {
  await assert.rejects(
    () => controller().run({ language: 'klingon', source: 'x' }, req(cookieFor('u1'))),
    /Unknown language/,
  );
});

test('a saved snippet can be read back by its owner only', async () => {
  const c = controller();
  const saved = await c.saveSnippet(
    { language: 'python', title: 'Two Sum', source: 'print(1)' },
    req(cookieFor('u1')),
  );
  assert.equal(saved.title, 'Two Sum');
  assert.equal((await c.getSnippet(saved.id, req(cookieFor('u1')))).id, saved.id);
  await assert.rejects(() => c.getSnippet(saved.id, req(cookieFor('u2'))), /not found/i);
});

test('saving without a source is rejected', async () => {
  await assert.rejects(
    () => controller().saveSnippet({ language: 'python' }, req(cookieFor('u1'))),
    /source is required/,
  );
});
