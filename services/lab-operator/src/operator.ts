import { randomUUID } from 'node:crypto';
import type { RuntimeTier } from '@tenxlab/contracts';
import type { LabProvider } from '@tenxlab/lab-provider';
import {
  planPoolActions,
  findIdleSessions,
  findForksToStop,
  findForksToArchive,
  forkLifecycle,
  type ForkLifecycle,
} from '@tenxlab/runtime-policy';

/**
 * Warm-pool reconciler and idle sweeper.
 *
 * The API decides *what* a tenant may run; this service decides *how much is
 * already running*. Each tick it:
 *   1. computes the boot/reap actions that converge the pool on target,
 *   2. boots sandboxes through the LabProvider and registers them as warm,
 *   3. terminates ACTIVE sessions that have been idle past their tier limit,
 *   4. suspends running project forks idle past their limit (ADR-20), so a
 *      fork's compute is paid for only while a student is using it.
 *
 * All side effects go through injected ports, so the reconciler is testable
 * without a cluster.
 */

export interface PoolInventory {
  ready: Record<RuntimeTier, number>;
  booting: Record<RuntimeTier, number>;
}

export interface PoolConfig {
  target: Record<RuntimeTier, number>;
  maxInFlightPerTier: number;
  idleLimitsSeconds: Record<RuntimeTier, number>;
  /** Fork stop-when-idle thresholds (ADR-20); defaults apply when omitted. */
  forkLifecycle?: ForkLifecycle;
}

export interface OperatorSession {
  id: string;
  tier: RuntimeTier;
  status: string;
  lastActivityAt: Date;
}

/**
 * The slice of a project fork the sweep needs. `id` is the workspace id, which
 * is also the provider session id; `status` is the workspace lifecycle.
 */
export interface OperatorFork {
  id: string;
  status: string;
  createdAt: Date;
  lastActivityAt: Date;
}

/** Side-effecting ports the reconciler drives. */
export interface OperatorPorts {
  provider: LabProvider;
  getInventory(): Promise<PoolInventory>;
  listSessions(): Promise<OperatorSession[]>;
  terminateSession(id: string): Promise<void>;
  /** Record a booted sandbox so a later launch can claim it. */
  registerWarm(tier: RuntimeTier, providerRef: string): Promise<void>;
  /** Running/stopped project forks, for the ADR-20 stop-when-idle sweep. */
  listForks?(): Promise<OperatorFork[]>;
  /** Suspend a fork's compute (keeps its volume) and mark it stopped. */
  stopFork?(id: string): Promise<void>;
  /** Archive a long-stopped fork's volume. */
  archiveFork?(id: string): Promise<void>;
}

export interface ReconcileReport {
  booted: number;
  reaped: number;
  terminatedIdle: string[];
  /** Forks suspended this tick (ADR-20 stop-when-idle). */
  stoppedForks: string[];
  /** Forks whose volumes were archived this tick. */
  archivedForks: string[];
  errors: string[];
}

export class LabOperator {
  constructor(
    private readonly ports: OperatorPorts,
    private readonly config: PoolConfig,
  ) {}

  /** One reconciliation tick. Never throws: failures land in the report. */
  async tick(now = Date.now()): Promise<ReconcileReport> {
    const report: ReconcileReport = {
      booted: 0,
      reaped: 0,
      terminatedIdle: [],
      stoppedForks: [],
      archivedForks: [],
      errors: [],
    };

    await this.reconcilePool(report);
    await this.sweepIdle(now, report);
    await this.sweepForks(now, report);
    return report;
  }

  private async reconcilePool(report: ReconcileReport): Promise<void> {
    const inventory = await this.ports.getInventory();
    const actions = planPoolActions(inventory, {
      target: this.config.target,
      maxInFlightPerTier: this.config.maxInFlightPerTier,
    });

    for (const action of actions) {
      if (action.action !== 'boot') {
        // Reaping surplus sandboxes is best-effort; the pool self-corrects on
        // the next tick if a reap fails.
        report.reaped += action.count;
        continue;
      }
      for (let i = 0; i < action.count; i += 1) {
        try {
          const handle = await this.ports.provider.provision({
            exercise_id: '__warm_pool__',
            runtime_tier: action.tier,
            tenant_id: '__pool__',
            user_id: '__pool__',
            session_id: `warm-${randomUUID()}`,
            ttl_seconds: this.config.idleLimitsSeconds[action.tier] ?? 1800,
            network_policy: 'deny_all',
          });
          await this.ports.registerWarm(
            action.tier,
            handle.provider_ref ?? handle.session_id,
          );
          report.booted += 1;
        } catch (err) {
          report.errors.push(`boot ${action.tier}: ${describe(err)}`);
        }
      }
    }
  }

  private async sweepIdle(now: number, report: ReconcileReport): Promise<void> {
    const sessions = await this.ports.listSessions();
    const idle = findIdleSessions(sessions, this.config.idleLimitsSeconds, now);
    for (const id of idle) {
      try {
        await this.ports.terminateSession(id);
        report.terminatedIdle.push(id);
      } catch (err) {
        report.errors.push(`terminate ${id}: ${describe(err)}`);
      }
    }
  }

  /**
   * ADR-20: stop a running fork once it is idle, and archive a long-stopped
   * fork's volume. A fork's compute is the cost centre; its volume is cheap, so
   * a stopped fork keeps the student's files but pays for no compute. Forks are
   * skipped entirely when the deployment has no fork ports (a labs-only install).
   */
  private async sweepForks(now: number, report: ReconcileReport): Promise<void> {
    if (!this.ports.listForks || !this.ports.stopFork) return;
    const lifecycle = forkLifecycle(this.config.forkLifecycle);
    const forks = await this.ports.listForks();

    for (const id of findForksToStop(forks, lifecycle, now)) {
      try {
        await this.ports.stopFork(id);
        report.stoppedForks.push(id);
      } catch (err) {
        report.errors.push(`stop fork ${id}: ${describe(err)}`);
      }
    }

    if (!this.ports.archiveFork) return;
    for (const id of findForksToArchive(forks, lifecycle, now)) {
      try {
        await this.ports.archiveFork(id);
        report.archivedForks.push(id);
      } catch (err) {
        report.errors.push(`archive fork ${id}: ${describe(err)}`);
      }
    }
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
