import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProjectCopyService } from './copy.service';
import type { CopySuggester } from '../ai/ai-bridge.client';

/** A suggester that echoes back what it was given, recording the input. */
function fakeSuggester(): CopySuggester & { lastInput?: unknown } {
  const suggester: CopySuggester & { lastInput?: unknown } = {
    async suggestProjectCopy(input) {
      suggester.lastInput = input;
      return { title: 'T', description: 'D', basedOn: ['x'] };
    },
  };
  return suggester;
}

test('suggest returns unavailable when no suggester is configured', async () => {
  const service = new ProjectCopyService(null);
  const result = await service.suggest({ hint: 'anything' });
  assert.deepEqual(result, { ok: false, reason: 'unavailable' });
});

test('suggest forwards normalised input to the suggester', async () => {
  const suggester = fakeSuggester();
  const service = new ProjectCopyService(suggester);

  const result = await service.suggest({
    hint: '  task api  ',
    stacks: ['spring-boot', 'spring-boot', ' mongodb '],
    componentTitles: ['API', 'api', 'Web UI'],
  });

  assert.ok(result.ok);
  assert.deepEqual(suggester.lastInput, {
    hint: 'task api',
    stacks: ['spring-boot', 'mongodb'],
    componentTitles: ['API', 'Web UI'],
  });
  assert.equal(result.suggestion.title, 'T');
});

test('suggest caps the number of stacks and components', async () => {
  const suggester = fakeSuggester();
  const service = new ProjectCopyService(suggester);

  const stacks = Array.from({ length: 40 }, (_, i) => `s${i}`);
  await service.suggest({ stacks, componentTitles: stacks });

  const input = suggester.lastInput as { stacks: string[]; componentTitles: string[] };
  assert.equal(input.stacks.length, 12);
  assert.equal(input.componentTitles.length, 12);
});

test('suggest truncates an over-long hint', async () => {
  const suggester = fakeSuggester();
  const service = new ProjectCopyService(suggester);

  await service.suggest({ hint: 'x'.repeat(500) });

  const input = suggester.lastInput as { hint: string };
  assert.equal(input.hint.length, 200);
});

test('suggest tolerates missing lists', async () => {
  const suggester = fakeSuggester();
  const service = new ProjectCopyService(suggester);

  const result = await service.suggest({});

  assert.ok(result.ok);
  const input = suggester.lastInput as { stacks: string[]; componentTitles: string[] };
  assert.deepEqual(input.stacks, []);
  assert.deepEqual(input.componentTitles, []);
});
