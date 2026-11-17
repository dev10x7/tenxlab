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
 * enabled), and a Postgres-backed session/warm store. Fork workspaces are driven
 * through a *persistent* pod provider so a fork can be scaled to zero without
 * losing its volume (ADR-20).
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
    forkLifecycle: {
      idleLimitSeconds: Number(process.env.FORK_IDLE_SECONDS ?? 3600),
      maxSessionSeconds: Number(process.env.FORK_MAX_SESSION_SECONDS ?? 28_800),
      retentionDays: Number(process.env.FORK_RETENTION_DAYS ?? 90),
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
  return new PgOperatorPorts({
    databaseUrl,
    provider: buildProvider(),
    // Forks need a persistent workspace (a Deployment scaled to zero on idle),
    // which is a different provider mode from a lab's disposable pod.
    forkProvider: buildForkProvider(),
  });
}

/** Route tier-3 to KubeLab (when enabled) and tier-2 to the pod provider. */
function buildProvider(): LabProvider {
  return new RoutingProvider(buildRoutes());
}

/** The persistent pod provider the fork sweep drives (ADR-20). */
function buildForkProvider(): LabProvider {
  return new RoutingProvider(buildRoutes({ persistent: true }));
}

function buildRoutes(options: { persistent?: boolean } = {}): Record<string, LabProvider> {
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
      persistent: options.persistent ?? false,
    }),
  };

  // KubeLab is the tier-3 execution plane (ADR-8) and has no fork workspace
  // model, so it is only wired into the lab route set, never the fork one.
  if (
    !options.persistent &&
    (process.env.KUBELAB_ENABLED === 'true' || process.env.KUBELAB_ENABLED === '1')
  ) {
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

  return routes;
}
/* c8 ignore stop */
