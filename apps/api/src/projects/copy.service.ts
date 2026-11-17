import type { CopySuggester, CopySuggestion } from '../ai/ai-bridge.client';

export interface SuggestCopyInput {
  /** Free text the author already typed; used as the title subject. */
  hint?: string;
  /** Template stack slugs, e.g. ["spring-boot", "mongodb"]. */
  stacks?: string[];
  /** Technology slot names, e.g. ["Task API", "Web UI"]. */
  componentTitles?: string[];
}

export type SuggestCopyOutcome =
  | { ok: true; suggestion: CopySuggestion }
  | { ok: false; reason: 'unavailable' };

/** Caps, so a caller cannot turn the suggester into an unbounded prompt. */
const MAX_STACKS = 12;
const MAX_COMPONENTS = 12;
const MAX_HINT = 200;

/**
 * AI-suggested project title/description (ByteXL's "clear and catchy name" +
 * "concise and informative" description, §1.2 / §2.11).
 *
 * The suggester is the AI plane's deterministic generator (ADR-13); when the
 * AI plane is not configured the outcome is `unavailable` and the caller keeps
 * the author's own text rather than failing the request.
 */
export class ProjectCopyService {
  constructor(private readonly suggester: CopySuggester | null) {}

  async suggest(input: SuggestCopyInput): Promise<SuggestCopyOutcome> {
    if (!this.suggester) return { ok: false, reason: 'unavailable' };
    const suggestion = await this.suggester.suggestProjectCopy({
      hint: (input.hint ?? '').trim().slice(0, MAX_HINT),
      stacks: normaliseList(input.stacks, MAX_STACKS),
      componentTitles: normaliseList(input.componentTitles, MAX_COMPONENTS),
    });
    return { ok: true, suggestion };
  }
}

/** Trim, drop blanks, dedupe case-insensitively, and cap the length. */
function normaliseList(values: string[] | undefined, max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values ?? []) {
    const value = String(raw).trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= max) break;
  }
  return out;
}
