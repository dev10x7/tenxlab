import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import type { RuntimeTier } from '@tenxlab/contracts';
import type { LabProvider } from '@tenxlab/lab-provider';
import type { OperatorPorts, OperatorSession, PoolInventory } from './operator';

/** The slice of `pg.Pool` this module uses; injected so tests can fake it. */
export interface Queryable {
  query<T = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
}

/**
 * Postgres-backed ports for the warm-pool operator.
 *
 * The operator reads and writes two tables:
 *   - `lab_sessions`   (written by the API; read here for the idle sweep)
 *   - `warm_sandboxes` (written here; the pool's inventory of ready capacity)
 *
 * Ticks are serialised in `main.ts`, so no sandbox is mid-boot when inventory
 * is read; `booting` is always zero here.
 */
export interface PgPortsOptions {
  provider: LabProvider;
  /** Connection string, or an already-constructed pool (tests). */
  databaseUrl?: string;
  pool?: Queryable;
}

const ZERO_TIERS: Record<RuntimeTier, number> = {
  tier_1_microvm: 0,
  tier_2_container: 0,
  tier_3_vcluster: 0,
};

export class PgOperatorPorts implements OperatorPorts {
  readonly provider: LabProvider;
  private readonly pool: Queryable;
  private readonly owned: Pool | null;

  constructor(opts: PgPortsOptions) {
    this.provider = opts.provider;
    if (opts.pool) {
      this.pool = opts.pool;
      this.owned = null;
    } else {
      this.owned = new Pool({ connectionString: opts.databaseUrl });
      this.pool = this.owned;
    }
  }

  async close(): Promise<void> {
    await this.owned?.end();
  }

  async getInventory(): Promise<PoolInventory> {
    const { rows } = await this.pool.query<{ tier: string; count: string }>(
      'SELECT tier, COUNT(*)::text AS count FROM warm_sandboxes GROUP BY tier',
    );
    const ready = { ...ZERO_TIERS };
    for (const row of rows) {
      if (row.tier in ready) ready[row.tier as RuntimeTier] = Number(row.count);
    }
    return { ready, booting: { ...ZERO_TIERS } };
  }

  async listSessions(): Promise<OperatorSession[]> {
    const { rows } = await this.pool.query<{
      id: string;
      tier: string;
      status: string;
      lastActivityAt: Date;
    }>(
      `SELECT id, tier, status, "lastActivityAt"
         FROM lab_sessions
        WHERE status = 'ACTIVE'`,
    );
    return rows.map((r) => ({
      id: r.id,
      tier: r.tier as RuntimeTier,
      status: r.status,
      lastActivityAt: new Date(r.lastActivityAt),
    }));
  }

  async terminateSession(id: string): Promise<void> {
    const { rows } = await this.pool.query<{ kubelabRef: string | null }>(
      'SELECT "kubelabRef" FROM lab_sessions WHERE id = $1',
      [id],
    );
    const ref = rows[0]?.kubelabRef;
    if (ref) await this.provider.terminate(ref);
    await this.pool.query(
      `UPDATE lab_sessions SET status = 'TERMINATED', "lastActivityAt" = now() WHERE id = $1`,
      [id],
    );
  }

  async registerWarm(tier: RuntimeTier, providerRef: string): Promise<void> {
    await this.pool.query(
      'INSERT INTO warm_sandboxes (id, tier, "providerRef") VALUES ($1, $2, $3)',
      [randomUUID(), tier, providerRef],
    );
  }
}
