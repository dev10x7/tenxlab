import type { RuntimeTier } from '@tenxlab/contracts';

/**
 * Cost telemetry.
 *
 * Turns raw session usage into billable, per-tenant cost so finance and capacity
 * planning have one source of truth. Rates are per sandbox-hour; a session is
 * charged for the wall-clock it was alive, rounded up to the nearest minute so
 * short-lived sessions are not free.
 */

export interface TierRate {
  /** Cost in USD cents per sandbox-hour. */
  centsPerHour: number;
  /** Fixed cost in USD cents charged on every provision. */
  centsPerProvision: number;
}

export type RateCard = Record<RuntimeTier, TierRate>;

export const DEFAULT_RATE_CARD: RateCard = {
  tier_1_microvm: { centsPerHour: 6, centsPerProvision: 1 },
  tier_2_container: { centsPerHour: 2, centsPerProvision: 1 },
  tier_3_vcluster: { centsPerHour: 9, centsPerProvision: 2 },
};

export interface SessionUsage {
  sessionId: string;
  tenantId: string;
  tier: RuntimeTier;
  startedAt: Date;
  endedAt: Date;
}

export interface SessionCost {
  sessionId: string;
  tenantId: string;
  tier: RuntimeTier;
  billableMinutes: number;
  cents: number;
}

export interface TenantCostSummary {
  tenantId: string;
  totalCents: number;
  sessions: SessionCost[];
  byTier: Record<string, number>;
}

/** Round a duration up to whole minutes (a 1-second session bills one minute). */
export function billableMinutes(startedAt: Date, endedAt: Date): number {
  const ms = Math.max(0, endedAt.getTime() - startedAt.getTime());
  return Math.ceil(ms / 60_000);
}

export function costSession(
  usage: SessionUsage,
  rateCard: RateCard = DEFAULT_RATE_CARD,
): SessionCost {
  const rate = rateCard[usage.tier];
  const minutes = billableMinutes(usage.startedAt, usage.endedAt);
  const timeCost = Math.ceil((minutes / 60) * rate.centsPerHour);
  return {
    sessionId: usage.sessionId,
    tenantId: usage.tenantId,
    tier: usage.tier,
    billableMinutes: minutes,
    cents: rate.centsPerProvision + timeCost,
  };
}

export function summarizeTenantCost(
  tenantId: string,
  usage: SessionUsage[],
  rateCard: RateCard = DEFAULT_RATE_CARD,
): TenantCostSummary {
  const sessions: SessionCost[] = [];
  const byTier: Record<string, number> = {};
  let totalCents = 0;

  for (const u of usage) {
    if (u.tenantId !== tenantId) continue;
    const cost = costSession(u, rateCard);
    sessions.push(cost);
    byTier[u.tier] = (byTier[u.tier] ?? 0) + cost.cents;
    totalCents += cost.cents;
  }

  return { tenantId, totalCents, sessions, byTier };
}

/** Convert cents to a display string, e.g. 1234 -> "$12.34". */
export function formatUsd(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
