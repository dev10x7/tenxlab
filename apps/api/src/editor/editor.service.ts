import {
  EDITOR_LANGUAGES,
  editorLanguage,
  type CodeRunResult,
  type EditorLanguage,
} from '@tenxlab/contracts';
import type { CodeExecutionProvider } from '@tenxlab/lab-provider';
import type { SnippetRecord, SnippetRepository } from '../common/ports';

export interface RunOutcome {
  ok: true;
  result: CodeRunResult;
}

export type RunFailure = { ok: false; reason: 'unknown_language' | 'no_runner' };

export interface EditorDeps {
  snippets: SnippetRepository;
  /** Null disables execution (no tier-1 pool configured); snippets still work. */
  runner?: CodeExecutionProvider | null;
}

/**
 * The Editor surface: run code and save snippets.
 *
 * Two capabilities, deliberately separate. Running is stateless and needs the
 * tier-1 execution pool; saving is durable and needs only the snippet store. A
 * deployment with no pool configured still lets students write and keep code —
 * only the Run button is dark.
 */
export class EditorService {
  constructor(private readonly deps: EditorDeps) {}

  /** The languages the picker offers, with their starter templates. */
  languages(): EditorLanguage[] {
    return EDITOR_LANGUAGES;
  }

  async run(input: {
    language: string;
    source: string;
    stdin?: string;
  }): Promise<RunOutcome | RunFailure> {
    const lang = editorLanguage(input.language);
    if (!lang) return { ok: false, reason: 'unknown_language' };
    if (!this.deps.runner) return { ok: false, reason: 'no_runner' };

    const result = await this.deps.runner.run({
      runtime: lang.pistonRuntime,
      source: input.source,
      stdin: input.stdin ?? '',
    });
    return { ok: true, result };
  }

  async saveSnippet(input: {
    userId: string;
    language: string;
    title: string;
    source: string;
    stdin?: string;
  }): Promise<SnippetRecord> {
    const language = editorLanguage(input.language) ? input.language : 'python';
    return this.deps.snippets.create({
      userId: input.userId,
      language,
      title: input.title.trim() || 'Untitled',
      source: input.source,
      stdin: input.stdin ?? '',
    });
  }

  async updateSnippet(
    id: string,
    userId: string,
    patch: Partial<Pick<SnippetRecord, 'title' | 'language' | 'source' | 'stdin'>>,
  ): Promise<SnippetRecord | null> {
    const clean: Partial<Pick<SnippetRecord, 'title' | 'language' | 'source' | 'stdin'>> = {};
    if (patch.title !== undefined) clean.title = patch.title.trim() || 'Untitled';
    if (patch.language !== undefined && editorLanguage(patch.language)) {
      clean.language = patch.language;
    }
    if (patch.source !== undefined) clean.source = patch.source;
    if (patch.stdin !== undefined) clean.stdin = patch.stdin;
    return this.deps.snippets.update(id, userId, clean);
  }

  listSnippets(userId: string): Promise<SnippetRecord[]> {
    return this.deps.snippets.listByUser(userId);
  }

  getSnippet(id: string, userId: string): Promise<SnippetRecord | null> {
    return this.deps.snippets.findById(id, userId);
  }

  deleteSnippet(id: string, userId: string): Promise<boolean> {
    return this.deps.snippets.delete(id, userId);
  }
}
