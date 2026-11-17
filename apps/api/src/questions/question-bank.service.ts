import type { BankQuestionRecord, BankQuestionRepository } from '../common/ports';

/** The question kinds the bank accepts, mirroring an assessment question. */
export const BANK_KINDS = ['coding', 'mcq', 'fill', 'descriptive'] as const;
export type BankKind = (typeof BANK_KINDS)[number];

export interface BankQuestionView {
  id: string;
  kind: BankKind;
  prompt: string;
  options: string[];
  correct: unknown;
  maxScore: number;
  tags: string[];
  createdAt: string;
}

export interface CreateBankQuestionInput {
  tenantId: string;
  createdBy: string;
  kind?: string;
  prompt?: string;
  options?: string[];
  correct?: unknown;
  maxScore?: number;
  tags?: string[];
}

/** Max prompt length, so a question cannot store an unbounded blob. */
export const BANK_PROMPT_MAX = 4000;

export function isBankKind(value: unknown): value is BankKind {
  return typeof value === 'string' && (BANK_KINDS as readonly string[]).includes(value);
}

/**
 * The Question Bank surface (parity §2.4): a tenant-scoped library of reusable
 * questions an author can drop into a test instead of re-typing it. Each row
 * mirrors an assessment question's shape, so a copy needs no translation.
 */
export class QuestionBankService {
  constructor(private readonly questions: BankQuestionRepository) {}

  /** The tenant's bank, newest first, optionally filtered by kind or tag. */
  async list(
    tenantId: string,
    filters: { kind?: string; tag?: string } = {},
  ): Promise<BankQuestionView[]> {
    const rows = await this.questions.listByTenant(tenantId);
    return rows
      .filter((r) => (filters.kind ? r.kind === filters.kind : true))
      .filter((r) => (filters.tag ? parseTags(r.tags).includes(filters.tag) : true))
      .map(toView);
  }

  /** Add a question to the bank. */
  async create(
    input: CreateBankQuestionInput,
  ): Promise<
    | { ok: true; question: BankQuestionView }
    | { ok: false; reason: 'invalid_kind' | 'prompt_required' | 'too_long' | 'options_required' }
  > {
    const kind = input.kind ?? '';
    if (!isBankKind(kind)) return { ok: false, reason: 'invalid_kind' };

    const prompt = input.prompt?.trim() ?? '';
    if (!prompt) return { ok: false, reason: 'prompt_required' };
    if (prompt.length > BANK_PROMPT_MAX) return { ok: false, reason: 'too_long' };

    const options = (input.options ?? []).map((o) => String(o)).filter((o) => o.trim());
    if ((kind === 'mcq') && options.length < 2) {
      return { ok: false, reason: 'options_required' };
    }

    const row = await this.questions.create({
      tenantId: input.tenantId,
      createdBy: input.createdBy,
      kind,
      prompt,
      options: options.length ? JSON.stringify(options) : null,
      correct: input.correct == null ? null : JSON.stringify(input.correct),
      maxScore: clampScore(input.maxScore),
      tags: input.tags?.length ? JSON.stringify(input.tags.map((t) => String(t))) : null,
    });
    return { ok: true, question: toView(row) };
  }

  /** Remove a question the caller's tenant owns. */
  async remove(tenantId: string, id: string): Promise<boolean> {
    const row = await this.questions.findById(id);
    if (!row || row.tenantId !== tenantId) return false;
    await this.questions.delete(id);
    return true;
  }
}

function clampScore(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.min(1000, Math.round(n));
}

function parseTags(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((t) => String(t)) : [];
  } catch {
    return [];
  }
}

function parseJson(raw: string | null): unknown {
  if (raw == null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function toView(row: BankQuestionRecord): BankQuestionView {
  const options = parseJson(row.options);
  return {
    id: row.id,
    kind: row.kind as BankKind,
    prompt: row.prompt,
    options: Array.isArray(options) ? options.map((o) => String(o)) : [],
    correct: parseJson(row.correct),
    maxScore: row.maxScore,
    tags: parseTags(row.tags),
    createdAt: row.createdAt.toISOString(),
  };
}
