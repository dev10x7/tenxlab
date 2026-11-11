import type { RuntimeTier } from '@tenxlab/contracts';

/**
 * Tenant quota policy.
 *
 * Quotas are checked before a sandbox is provisioned. Two dimensions matter in
 * practice: how many labs a tenant may run at once, and how much a tenant may
 * spend in a billing period. Both are enforced here so the launch path has a
 * single, testable gate.
 */

export interface TenantQuota {
  maxConcurrentLabs: number;
  /** Monthly spend ceiling in USD cents. 0 means unlimited. */
  monthlyBudgetCents: number;
}

export interface QuotaCheckInput {
  quota: TenantQuota;
  activeSessions: number;
  spentThisPeriodCents: number;
  /** Cost of the session about to be provisioned, if known. */
  estimatedCostCents?: number;
}

export type QuotaDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason: 'concurrency_exceeded' | 'budget_exceeded';
      message: string;
    };

export function checkQuota(input: QuotaCheckInput): QuotaDecision {
  const { quota, activeSessions, spentThisPeriodCents } = input;

  if (activeSessions >= quota.maxConcurrentLabs) {
    return {
      allowed: false,
      reason: 'concurrency_exceeded',
      message: `Concurrent-lab limit of ${quota.maxConcurrentLabs} reached`,
    };
  }

  if (quota.monthlyBudgetCents > 0) {
    const projected = spentThisPeriodCents + (input.estimatedCostCents ?? 0);
    if (projected > quota.monthlyBudgetCents) {
      return {
        allowed: false,
        reason: 'budget_exceeded',
        message: `Monthly budget of ${quota.monthlyBudgetCents} cents would be exceeded`,
      };
    }
  }

  return { allowed: true };
}

/**
 * Default idle limits per tier. MicroVMs and vclusters hold real resources and
 * are reaped sooner; plain containers are cheap and get more slack.
 */
export const DEFAULT_IDLE_LIMITS: Record<RuntimeTier, number> = {
  tier_1_microvm: 900,
  tier_2_container: 1800,
  tier_3_vcluster: 1200,
};

/** Fraction of budget at which to warn, as an integer percentage. */
export const BUDGET_WARN_PERCENT = 80;

export function budgetWarning(
  quota: TenantQuota,
  spentCents: number,
): { level: 'ok' | 'warning' | 'exceeded'; percent: number } | null {
  if (quota.monthlyBudgetCents <= 0) return null;
  const percent = Math.round((spentCents / quota.monthlyBudgetCents) * 100);
  if (percent >= 100) return { level: 'exceeded', percent };
  if (percent >= BUDGET_WARN_PERCENT) return { level: 'warning', percent };
  return { level: 'ok', percent };
}
