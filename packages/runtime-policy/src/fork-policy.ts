import type { RuntimeTier } from '@tenxlab/contracts';

/**
 * Fork cost/lifecycle policy (ADR-20).
 *
 * A project fork is a durable volume plus metadata; its compute exists only
 * while the student is active. Always-on forks would dominate spend, so a fork
 * is stopped when idle and its volume is kept. This module owns the pure policy
 * — which forks to stop, which to archive, and the fork's storage dimension —
 * so it is testable without a cluster or a database.
 *
 * Forks deliberately get their own limits and their own sweep, separate from
 * the lab operator's session sweep: a lab is short-lived (30 min) while a fork
 * must survive across a student's study sessions.
 */

/** A fork is stopped after this long without activity (60 minutes). */
export const FORK_IDLE_LIMIT_SECONDS = 3600;

/** A fork's compute is stopped after this long regardless of activity (8 h). */
export const FORK_MAX_SESSION_SECONDS = 8 * 3600;

/** A stopped fork's volume is archived after this long (90 days). */
export const FORK_RETENTION_DAYS = 90;

/** Forks default to tier-2 (a container workspace); tier-3 is opt-in. */
export const DEFAULT_FORK_TIER: RuntimeTier = 'tier_2_container';

/** Per-tier fork idle limits. Tier-3 vclusters are costlier, so they stop sooner. */
export const FORK_IDLE_LIMITS: Record<RuntimeTier, number> = {
  tier_1_microvm: 1800,
  tier_2_container: FORK_IDLE_LIMIT_SECONDS,
  tier_3_vcluster: 1800,
};

/** A fork's storage footprint, in gibibytes, by tier. */
export const FORK_STORAGE_GB: Record<RuntimeTier, number> = {
  tier_1_microvm: 1,
  tier_2_container: 2,
  tier_3_vcluster: 4,
};

export interface ForkLifecycle {
  /** A running fork stops after this long idle. */
  idleLimitSeconds: number;
  /** A running fork stops after this long even if active. */
  maxSessionSeconds: number;
  /** A stopped fork is archived after this long. */
  retentionDays: number;
}

/** The lifecycle a fork runs under, overridable for tests/ops. */
export function forkLifecycle(overrides: Partial<ForkLifecycle> = {}): ForkLifecycle {
  return {
    idleLimitSeconds: FORK_IDLE_LIMIT_SECONDS,
    maxSessionSeconds: FORK_MAX_SESSION_SECONDS,
    retentionDays: FORK_RETENTION_DAYS,
    ...overrides,
  };
}

/** The slice of a fork workspace the lifecycle policy needs. */
export interface ForkLifecycleInput {
  id: string;
  status: string;
  createdAt: Date;
  lastActivityAt: Date;
}

/**
 * Running forks that should be stopped: idle past the limit, or alive past the
 * max session. Only `running` forks are eligible — a `stopped` fork already
 * holds no compute, and a `provisioning` fork is mid-boot.
 */
export function findForksToStop(
  forks: ForkLifecycleInput[],
  lifecycle: ForkLifecycle,
  now: number,
): string[] {
  const ids: string[] = [];
  for (const f of forks) {
    if (f.status !== 'running') continue;
    const idleFor = (now - f.lastActivityAt.getTime()) / 1000;
    const aliveFor = (now - f.createdAt.getTime()) / 1000;
    if (idleFor >= lifecycle.idleLimitSeconds || aliveFor >= lifecycle.maxSessionSeconds) {
      ids.push(f.id);
    }
  }
  return ids;
}

/**
 * Stopped forks whose volume should be archived: stopped longer than the
 * retention window. `archived` forks are already cold, so they are skipped.
 */
export function findForksToArchive(
  forks: ForkLifecycleInput[],
  lifecycle: ForkLifecycle,
  now: number,
): string[] {
  const retentionSeconds = lifecycle.retentionDays * 24 * 3600;
  const ids: string[] = [];
  for (const f of forks) {
    if (f.status !== 'stopped') continue;
    const stoppedFor = (now - f.lastActivityAt.getTime()) / 1000;
    if (stoppedFor >= retentionSeconds) ids.push(f.id);
  }
  return ids;
}

/** Storage a fork of `tier` consumes, in GiB. */
export function forkStorageGb(tier: RuntimeTier): number {
  return FORK_STORAGE_GB[tier] ?? FORK_STORAGE_GB[DEFAULT_FORK_TIER];
}
