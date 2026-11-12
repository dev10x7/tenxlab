import {
  KubeLabAdapter,
  KubernetesClient,
  PodProvider,
  RoutingProvider,
  type LabProvider,
} from '@tenxlab/lab-provider';
import { LabOperator, type OperatorPorts, type PoolConfig } from './operator';
import { PgOperatorPorts } from './ports';

export * from './operator';
export * from './ports';

/**
 * Entry point. Runs as a long-lived process (or a Kubernetes CronJob) that
 * reconciles the warm pool every `RECONCILE_INTERVAL_MS`.
 *
 * The concrete ports are the pod provider for tier-2, KubeLab for tier-3 (when
 * enabled), and a Postgres-backed session/warm store.
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
  // A caller may inject ports (used by the integration test); otherwise the
  // deployment supplies a database URL and the provider is built from env.
  const ports =
    (globalThis as { __tenxlabOperatorPorts?: OperatorPorts }).__tenxlabOperatorPorts ??
    buildPorts();
  if (!ports) {
    console.error(
      'lab-operator: no OperatorPorts configured; set LAB_OPERATOR_DATABASE_URL ' +
        '(or DATABASE_URL) and inject __tenxlabOperatorPorts',
    );
    process.exit(1);
  }

  // One-shot mode for a Kubernetes CronJob: reconcile once, then exit.
  if (process.env.RECONCILE_ONCE === 'true' || process.env.RECONCILE_ONCE === '1') {
    runOnce(ports)
      .then(() => process.exit(0))
      .catch((err) => {
        console.error('reconcile failed', err);
        process.exit(1);
      });
  } else {
    const intervalMs = Number(process.env.RECONCILE_INTERVAL_MS ?? 30_000);
    let running = false;
    const tick = async () => {
      // A slow provision must not overlap the next tick, or the pool double-boots.
      if (running) return;
      running = true;
      try {
        await runOnce(ports);
      } catch (err) {
        console.error('reconcile failed', err);
      } finally {
        running = false;
      }
    };
    void tick();
    setInterval(tick, intervalMs);
  }
}

function buildPorts(): OperatorPorts | null {
  const databaseUrl = process.env.LAB_OPERATOR_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) return null;
  return new PgOperatorPorts({ databaseUrl, provider: buildProvider() });
}

/**
 * Route tier-3 to KubeLab (when enabled) and tier-2 to the pod provider. The
 * pod provider is always present because it only needs the cluster client.
 */
function buildProvider(): LabProvider {
  const allowedHosts = process.env.KUBELAB_ALLOWED_HOSTS ?? '192.168.49.2.nip.io';
  const ideScheme = (process.env.KUBELAB_IDE_SCHEME as 'https' | 'http') ?? 'https';
  const assetBase = (process.env.LAB_ASSET_BASE_URL ?? '').replace(/\/$/, '');

  const routes: Record<string, LabProvider> = {
    tier_2_container: new PodProvider({
      cluster: new KubernetesClient(),
      allowedHosts,
      ideScheme,
      publicIdeBaseUrl: process.env.KUBELAB_IDE_PUBLIC_URL,
      codeServerImage: process.env.CODE_SERVER_IMAGE,
    }),
  };

  if (process.env.KUBELAB_ENABLED === 'true' || process.env.KUBELAB_ENABLED === '1') {
    routes['tier_3_vcluster'] = new KubeLabAdapter({
      baseUrl: process.env.KUBELAB_BASE_URL ?? 'http://localhost:8090',
      adminEmail: process.env.KUBELAB_ADMIN_EMAIL ?? 'tenxlab@tenxlab.local',
      adminPassword: process.env.KUBELAB_ADMIN_PASSWORD ?? '',
      allowedHosts,
      ideScheme,
      publicIdeBaseUrl: process.env.KUBELAB_IDE_PUBLIC_URL,
      resolveExercise: (slug) => ({
        labSlug: slug,
        labTitle: slug,
        exerciseTitle: slug,
        bootstrapUrl: `${assetBase}/api/labs/assets/${slug}/bootstrap.sh`,
        checkUrl: `${assetBase}/api/labs/assets/${slug}/check.sh`,
      }),
      resolveUser: (userId) => ({ email: `${userId}@tenxlab.local`, name: userId }),
    });
  }

  return new RoutingProvider(routes);
}
/* c8 ignore stop */
