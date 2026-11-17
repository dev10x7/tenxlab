import type { SupportIssueRecord, SupportIssueRepository } from '../common/ports';

/** The categories a reporter may choose; anything else is rejected upstream. */
export const SUPPORT_CATEGORIES = ['bug', 'feature', 'question', 'other'] as const;
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];

/** The lifecycle of a support issue, as seen by the support queue. */
export const SUPPORT_STATUSES = ['open', 'in_progress', 'resolved'] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];

/** Max lengths, so a report cannot be used to store an unbounded blob. */
export const SUPPORT_TITLE_MAX = 200;
export const SUPPORT_DESCRIPTION_MAX = 4000;

export interface SupportIssueDto {
  id: string;
  category: SupportCategory;
  title: string;
  description: string;
  pageUrl: string | null;
  status: SupportStatus;
  createdAt: string;
}

export interface CreateSupportIssueInput {
  tenantId: string;
  userId: string | null;
  category?: string;
  title?: string;
  description?: string;
  pageUrl?: string | null;
}

export type CreateSupportIssueResult =
  | { ok: true; issue: SupportIssueDto }
  | {
      ok: false;
      reason:
        | 'invalid_category'
        | 'title_required'
        | 'description_required'
        | 'too_long';
    };

export function isSupportCategory(value: unknown): value is SupportCategory {
  return typeof value === 'string' && (SUPPORT_CATEGORIES as readonly string[]).includes(value);
}

export function isSupportStatus(value: unknown): value is SupportStatus {
  return typeof value === 'string' && (SUPPORT_STATUSES as readonly string[]).includes(value);
}

/**
 * The Report-an-Issue surface (ByteXL's in-product support form). A report is
 * validated, normalised, and stored; the queue is scoped to a tenant so one
 * tenant's support desk never sees another's reports.
 */
export class SupportService {
  constructor(private readonly issues: SupportIssueRepository) {}

  async create(input: CreateSupportIssueInput): Promise<CreateSupportIssueResult> {
    const category = input.category ?? 'other';
    if (!isSupportCategory(category)) return { ok: false, reason: 'invalid_category' };

    const title = input.title?.trim() ?? '';
    if (!title) return { ok: false, reason: 'title_required' };
    if (title.length > SUPPORT_TITLE_MAX) return { ok: false, reason: 'too_long' };

    const description = input.description?.trim() ?? '';
    if (!description) return { ok: false, reason: 'description_required' };
    if (description.length > SUPPORT_DESCRIPTION_MAX) return { ok: false, reason: 'too_long' };

    const pageUrl = input.pageUrl?.trim() || null;

    const row = await this.issues.create({
      tenantId: input.tenantId,
      userId: input.userId,
      category,
      title,
      description,
      pageUrl,
      status: 'open',
    });
    return { ok: true, issue: toDto(row) };
  }

  /** The tenant's support queue, newest first. */
  async list(tenantId: string): Promise<SupportIssueDto[]> {
    const rows = await this.issues.listByTenant(tenantId);
    return rows.map(toDto);
  }

  /** Move an issue through the queue. Unknown ids or statuses are rejected. */
  async setStatus(
    id: string,
    tenantId: string,
    status: string,
  ): Promise<
    | { ok: true; issue: SupportIssueDto }
    | { ok: false; reason: 'not_found' | 'invalid_status' }
  > {
    if (!isSupportStatus(status)) return { ok: false, reason: 'invalid_status' };
    const existing = await this.issues.findById(id);
    if (!existing || existing.tenantId !== tenantId) {
      return { ok: false, reason: 'not_found' };
    }
    const row = await this.issues.update(id, { status });
    return { ok: true, issue: toDto(row) };
  }
}

function toDto(row: SupportIssueRecord): SupportIssueDto {
  return {
    id: row.id,
    category: row.category as SupportCategory,
    title: row.title,
    description: row.description,
    pageUrl: row.pageUrl ?? null,
    status: row.status as SupportStatus,
    createdAt: row.createdAt.toISOString(),
  };
}
