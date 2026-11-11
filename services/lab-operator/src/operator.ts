import { randomUUID } from 'node:crypto';
import type { RuntimeTier } from '@tenxlab/contracts';
import type { LabProvider } from '@tenxlab/lab-provider';
import { planPoolActions, findIdleSessions } from '@tenxlab/runtime-policy';

/**
 * Warm-pool reconciler and idle sweeper.
 *
 * The API decides *what* a tenant may run; this service decides *how much is
 * already running*. Each tick it:
 *   1. computes the boot/reap actions that converge the pool on target,
 *   2. boots sandboxes through the LabProvider and registers them as warm,
 *   3. terminates ACTIVE sessions that have been idle past their tier limit.
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
}

export interface OperatorSession {
  id: string;
  tier: RuntimeTier;
  status: string;
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
}

export interface ReconcileReport {
  booted: number;
  reaped: number;
  terminatedIdle: string[];
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
      errors: [],
    };

    await this.reconcilePool(report);
    await this.sweepIdle(now, report);
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
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
