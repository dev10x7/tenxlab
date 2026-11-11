import type { RuntimeTier } from '@tenxlab/contracts';

/**
 * Warm-pool accounting.
 *
 * A warm pool keeps a small number of pre-booted sandboxes per tier so a
 * student's "launch" is a claim rather than a cold start. This class owns the
 * pure policy: how many slots each tier should hold, what the current deficit
 * is, and which idle sessions to reap. The operator that actually boots and
 * deletes sandboxes is a separate, side-effecting process (see
 * services/lab-operator); keeping the policy pure makes it testable.
 */

export interface PoolState {
  /** Ready (unclaimed) sandboxes per tier. */
  ready: Record<RuntimeTier, number>;
  /** Sandboxes currently being booted per tier. */
  booting: Record<RuntimeTier, number>;
}

export interface WarmPoolConfig {
  /** Desired number of ready sandboxes per tier. */
  target: Record<RuntimeTier, number>;
  /** Never boot more than this many at once, per tier. */
  maxInFlightPerTier: number;
}

export interface PoolAction {
  tier: RuntimeTier;
  action: 'boot' | 'reap';
  count: number;
}

/** Compute the boot/reap actions needed to converge on the target pool size. */
export function planPoolActions(
  state: PoolState,
  config: WarmPoolConfig,
): PoolAction[] {
  const actions: PoolAction[] = [];
  const tiers = Object.keys(config.target) as RuntimeTier[];

  for (const tier of tiers) {
    const target = config.target[tier] ?? 0;
    const ready = state.ready[tier] ?? 0;
    const booting = state.booting[tier] ?? 0;

    if (ready > target) {
      actions.push({ tier, action: 'reap', count: ready - target });
      continue;
    }

    const deficit = target - ready - booting;
    if (deficit > 0) {
      actions.push({
        tier,
        action: 'boot',
        count: Math.min(deficit, config.maxInFlightPerTier),
      });
    }
  }

  return actions;
}

export interface IdleSession {
  id: string;
  tier: RuntimeTier;
  lastActivityAt: Date;
  /** Session status; only ACTIVE sessions are eligible for idle reaping. */
  status: string;
}

/**
 * Return the ids of sessions that have been idle beyond their tier's limit.
 * ACTIVE sessions are the only ones that consume quota, so only they are reaped
 * here; WARM sessions are handled by the pool planner.
 */
export function findIdleSessions(
  sessions: IdleSession[],
  idleLimitsSeconds: Record<RuntimeTier, number>,
  now: number,
): string[] {
  const idle: string[] = [];
  for (const s of sessions) {
    if (s.status !== 'ACTIVE') continue;
    const limit = idleLimitsSeconds[s.tier];
    if (limit == null) continue;
    const idleFor = (now - s.lastActivityAt.getTime()) / 1000;
    if (idleFor >= limit) idle.push(s.id);
  }
  return idle;
}
