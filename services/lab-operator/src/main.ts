import { LabOperator, type OperatorPorts, type PoolConfig } from './operator';

export * from './operator';

/**
 * Entry point. In production this runs as a long-lived process driven by a
 * scheduler (or a Kubernetes CronJob); here it wires the reconciler from
 * environment configuration and ticks on an interval.
 */
function loadConfig(): PoolConfig {
  return {
    target: {
      tier_1_microvm: Number(process.env.WARM_TIER1 ?? 1),
      tier_2_container: Number(process.env.WARM_TIER2 ?? 4),
      tier_3_vcluster: Number(process.env.WARM_TIER3 ?? 1),
    },
    maxInFlightPerTier: Number(process.env.WARM_MAX_IN_FLIGHT ?? 2),
    idleLimitsSeconds: {
      tier_1_microvm: Number(process.env.IDLE_TIER1 ?? 900),
      tier_2_container: Number(process.env.IDLE_TIER2 ?? 1800),
      tier_3_vcluster: Number(process.env.IDLE_TIER3 ?? 1200),
    },
  };
}

export async function runOnce(ports: OperatorPorts): Promise<void> {
  const operator = new LabOperator(ports, loadConfig());
  const report = await operator.tick();
  console.log(JSON.stringify({ event: 'reconcile', ...report }));
}

/* c8 ignore start -- process wiring, exercised by deployment not unit tests */
if (require.main === module) {
  const intervalMs = Number(process.env.RECONCILE_INTERVAL_MS ?? 30_000);
  // The concrete ports (KubeLab-backed provider, DB-backed session store) are
  // supplied by the deployment; see services/lab-operator/README.md.
  const ports = (globalThis as { __tenxlabOperatorPorts?: OperatorPorts })
    .__tenxlabOperatorPorts;
  if (!ports) {
    console.error(
      'lab-operator: no OperatorPorts configured; set them via the deployment bootstrap',
    );
    process.exit(1);
  }
  setInterval(() => {
    runOnce(ports).catch((err) => console.error('reconcile failed', err));
  }, intervalMs);
}
/* c8 ignore stop */
