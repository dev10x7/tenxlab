import {
  budgetWarning,
  checkQuota,
  costSession,
  DEFAULT_RATE_CARD,
  type RateCard,
  type SessionUsage,
} from '@tenxlab/runtime-policy';
import type { RuntimeTier } from '@tenxlab/contracts';
import type {
  LabSessionRecord,
  LabSessionRepository,
  TenantRepository,
} from '../common/ports';

/** A session that never reported an end is billed to the present. */
const ACTIVE_STATUSES = new Set(['WARM', 'ACTIVE', 'IDLE']);

export interface TenantUsageView {
  tenantId: string;
  periodStart: string;
  totalCents: number;
  byTier: Record<string, number>;
  activeSessions: number;
  budget: {
    monthlyBudgetCents: number;
    spentCents: number;
    percent: number;
    level: 'ok' | 'warning' | 'exceeded';
  } | null;
}

/**
 * Tenant cost and quota reporting.
 *
 * The runtime-policy package holds the pure cost math; this service supplies the
 * data (sessions from the system of record) and the tenant's quota, so the
 * dashboard and the launch gate read the same numbers.
 */
export class UsageService {
  constructor(
    private readonly deps: {
      tenants: TenantRepository;
      sessions: LabSessionRepository;
      rateCard?: RateCard;
      /** Injected for deterministic tests; defaults to the wall clock. */
      now?: () => Date;
    },
  ) {}

  private rateCard(): RateCard {
    return this.deps.rateCard ?? DEFAULT_RATE_CARD;
  }

  /** Cents a tenant has spent in the current calendar month. */
  async spentThisPeriodCents(tenantId: string): Promise<number> {
    const now = this.now();
    const periodStart = monthStart(now);
    const sessions = await this.deps.sessions.listByTenant(tenantId);
    let total = 0;
    for (const s of sessions) {
      const endedAt = sessionEnd(s, now);
      if (endedAt < periodStart) continue;
      total += costSession(toUsage(s, endedAt), this.rateCard()).cents;
    }
    return total;
  }

  /** The full usage view for a tenant, for the Nimbus dashboard. */
  async summarize(tenantId: string): Promise<TenantUsageView> {
    const now = this.now();
    const periodStart = monthStart(now);
    const tenant = await this.deps.tenants.findById(tenantId);
    const sessions = await this.deps.sessions.listByTenant(tenantId);

    const byTier: Record<string, number> = {};
    let totalCents = 0;
    let activeSessions = 0;
    for (const s of sessions) {
      if (ACTIVE_STATUSES.has(s.status)) activeSessions += 1;
      const endedAt = sessionEnd(s, now);
      if (endedAt < periodStart) continue;
      const cost = costSession(toUsage(s, endedAt), this.rateCard());
      byTier[s.tier] = (byTier[s.tier] ?? 0) + cost.cents;
      totalCents += cost.cents;
    }

    const monthlyBudgetCents = tenant?.monthlyBudgetCents ?? 0;
    const warning =
      monthlyBudgetCents > 0
        ? budgetWarning({ maxConcurrentLabs: 0, monthlyBudgetCents }, totalCents)
        : null;

    return {
      tenantId,
      periodStart: periodStart.toISOString(),
      totalCents,
      byTier,
      activeSessions,
      budget: warning
        ? {
            monthlyBudgetCents,
            spentCents: totalCents,
            percent: warning.percent,
            level: warning.level,
          }
        : null,
    };
  }

  /**
   * The launch gate: a tenant may start a lab only if it is under both its
   * concurrency limit and its monthly budget. Returns null when allowed.
   */
  async checkLaunch(
    tenantId: string,
    estimatedCostCents: number,
  ): Promise<{ reason: 'concurrency_exceeded' | 'budget_exceeded'; message: string } | null> {
    const tenant = await this.deps.tenants.findById(tenantId);
    if (!tenant) return null;
    const activeSessions = await this.deps.sessions.countActiveByTenant(tenantId);
    const spentThisPeriodCents = await this.spentThisPeriodCents(tenantId);
    const decision = checkQuota({
      quota: {
        maxConcurrentLabs: tenant.maxConcurrentLabs,
        monthlyBudgetCents: tenant.monthlyBudgetCents,
      },
      activeSessions,
      spentThisPeriodCents,
      estimatedCostCents,
    });
    return decision.allowed
      ? null
      : { reason: decision.reason, message: decision.message };
  }

  private now(): Date {
    return this.deps.now ? this.deps.now() : new Date();
  }
}

function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function sessionEnd(session: LabSessionRecord, now: Date): Date {
  return ACTIVE_STATUSES.has(session.status) ? now : session.lastActivityAt;
}

function toUsage(session: LabSessionRecord, endedAt: Date): SessionUsage {
  return {
    sessionId: session.id,
    tenantId: session.tenantId,
    tier: session.tier as RuntimeTier,
    startedAt: session.startedAt,
    endedAt,
  };
}
