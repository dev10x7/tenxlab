import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CodeRunResult } from '@tenxlab/contracts';
import type { CodeExecutionProvider, CodeRunInput } from '@tenxlab/lab-provider';
import { InMemorySnippetRepository } from '../common/in-memory';
import { EditorService } from './editor.service';

/** Records each run and returns a canned result. */
function fakeRunner(result?: Partial<CodeRunResult>) {
  const calls: CodeRunInput[] = [];
  const provider: CodeExecutionProvider = {
    name: 'fake',
    async run(input) {
      calls.push(input);
      return {
        stdout: 'ok\n',
        stderr: '',
        exitCode: 0,
        executionTimeMs: 1,
        timedOut: false,
        unsupported: false,
        ...result,
      };
    },
  };
  return { calls, provider };
}

function service(runner: CodeExecutionProvider | null) {
  return new EditorService({ snippets: new InMemorySnippetRepository(), runner });
}

test('languages exposes the curated catalog with templates', () => {
  const langs = service(null).languages();
  assert.ok(langs.length >= 4);
  const python = langs.find((l) => l.id === 'python');
  assert.ok(python);
  assert.equal(python.pistonRuntime, 'python');
  assert.match(python.template, /start your solution/);
});

test('run maps the language id onto the Piston runtime', async () => {
  const { calls, provider } = fakeRunner();
  const outcome = await service(provider).run({
    language: 'cpp',
    source: 'int main(){}',
    stdin: 'x',
  });
  assert.equal(outcome.ok, true);
  assert.equal(calls[0]!.runtime, 'c++');
  assert.equal(calls[0]!.stdin, 'x');
});

test('run rejects an unknown language without calling the pool', async () => {
  const { calls, provider } = fakeRunner();
  const outcome = await service(provider).run({ language: 'brainfuck', source: '+' });
  assert.deepEqual(outcome, { ok: false, reason: 'unknown_language' });
  assert.equal(calls.length, 0);
});

test('run reports no_runner when execution is not configured', async () => {
  const outcome = await service(null).run({ language: 'python', source: 'print(1)' });
  assert.deepEqual(outcome, { ok: false, reason: 'no_runner' });
});

test('saving a snippet trims the title and defaults an empty one', async () => {
  const editor = service(null);
  const saved = await editor.saveSnippet({
    userId: 'u1',
    language: 'python',
    title: '  Two Sum  ',
    source: 'print(1)',
  });
  assert.equal(saved.title, 'Two Sum');
  assert.equal(saved.userId, 'u1');

  const untitled = await editor.saveSnippet({
    userId: 'u1',
    language: 'python',
    title: '   ',
    source: 'x',
  });
  assert.equal(untitled.title, 'Untitled');
});

test('an unknown language on save falls back to python', async () => {
  const saved = await service(null).saveSnippet({
    userId: 'u1',
    language: 'klingon',
    title: 'x',
    source: 'x',
  });
  assert.equal(saved.language, 'python');
});

test('snippets are scoped to their owner', async () => {
  const editor = service(null);
  const saved = await editor.saveSnippet({
    userId: 'u1',
    language: 'python',
    title: 'Mine',
    source: 'x',
  });
  assert.equal(await editor.getSnippet(saved.id, 'u2'), null);
  assert.equal(await editor.deleteSnippet(saved.id, 'u2'), false);
  assert.equal((await editor.getSnippet(saved.id, 'u1'))?.id, saved.id);
});

test('update ignores an unknown language but applies the rest', async () => {
  const editor = service(null);
  const saved = await editor.saveSnippet({
    userId: 'u1',
    language: 'python',
    title: 'Draft',
    source: 'x',
  });
  const updated = await editor.updateSnippet(saved.id, 'u1', {
    title: 'Final',
    language: 'klingon',
    source: 'y',
  });
  assert.equal(updated?.title, 'Final');
  assert.equal(updated?.language, 'python');
  assert.equal(updated?.source, 'y');
});

test('listSnippets returns a user’s own snippets, newest first', async () => {
  const editor = service(null);
  const a = await editor.saveSnippet({ userId: 'u1', language: 'python', title: 'A', source: 'a' });
  const b = await editor.saveSnippet({ userId: 'u1', language: 'python', title: 'B', source: 'b' });
  await editor.saveSnippet({ userId: 'u2', language: 'python', title: 'C', source: 'c' });
  // Bump A so it sorts ahead of B.
  await editor.updateSnippet(a.id, 'u1', { source: 'a2' });
  const list = await editor.listSnippets('u1');
  assert.equal(list.length, 2);
  assert.equal(list[0]!.id, a.id);
  assert.equal(list[1]!.id, b.id);
});
