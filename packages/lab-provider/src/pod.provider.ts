import type { LabSpec, SessionHandle } from '@tenxlab/contracts';
import { LabProviderError, type LabProvider } from './types';

/**
 * The slice of the Kubernetes API the tier-2 provider needs.
 *
 * Declaring it here rather than importing a client type keeps the provider
 * dependency-free (and the license gate happy) and lets tests drive it with an
 * in-memory fake. A concrete implementation for a real cluster lives in
 * `kubernetes-client.ts` (exported alongside this provider).
 */
export interface ClusterClient {
  /** Create or replace an object. `manifest` is a full Kubernetes object. */
  apply(manifest: Record<string, unknown>): Promise<void>;
  /** Delete an object. A missing object is not an error. */
  delete(kind: string, name: string, namespace: string): Promise<void>;
  /** Read an object, or null when it does not exist. */
  get(kind: string, name: string, namespace: string): Promise<Record<string, unknown> | null>;
  /** List objects of a kind in a namespace. */
  list(kind: string, namespace: string): Promise<Record<string, unknown>[]>;
}

export interface PodProviderOptions {
  cluster: ClusterClient;
  /**
   * Public base URL that fronts per-session IDE ingress hosts, so a remote
   * browser can reach a cluster whose node IP it cannot route to. When set,
   * IDE URLs are emitted as `<base>/lab/<ingress-host>/`; readiness still
   * probes the ingress directly. Mirrors the KubeLab adapter's option.
   */
  publicIdeBaseUrl?: string;
  /** Wildcard base the per-session ingress host is built under. */
  allowedHosts: string;
  /** Scheme for the IDE ingress. */
  ideScheme?: 'https' | 'http';
  /** Container image served to the student (code-server + terminal). */
  codeServerImage?: string;
  /** How long to wait for the IDE to answer before returning a WARM handle. */
  readinessTimeoutMs?: number;
  readinessPollMs?: number;
  /** Injected for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

const NAMESPACE_PREFIX = 'tenxlab-t2-';
const PORT = 8080;
const READY_TIMEOUT_MS = 90_000;
const READY_POLL_MS = 2_000;

/**
 * Tier-2 lab provider: one isolated Pod per session (code-server + terminal),
 * with no nested control plane.
 *
 * KubeLab is vcluster-only (ADR-8), so tier-2 is ours to build. It shares the
 * `LabProvider` seam with `KubeLabAdapter` — the LMS routes by `runtime_tier`
 * and never learns which provider answered. A session is:
 *
 *   namespace tenxlab-t2-<session>
 *     ├─ PersistentVolumeClaim  workspace
 *     ├─ Pod                    code-server (image + PVC at /home/coder)
 *     ├─ Service                ClusterIP:8080
 *     └─ Ingress                <ns>.<allowedHosts> -> Service
 *
 * Teardown deletes the namespace, which cascades to everything inside it.
 */
export class PodProvider implements LabProvider {
  readonly name = 'pod';

  private readonly cluster: ClusterClient;
  private readonly fetchImpl: typeof fetch;
  private readonly scheme: string;
  private readonly publicIdeBaseUrl: string | null;
  private readonly codeServerImage: string;
  private readonly readinessTimeoutMs: number;
  private readonly readinessPollMs: number;

  constructor(private readonly opts: PodProviderOptions) {
    this.cluster = opts.cluster;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.scheme = opts.ideScheme ?? 'https';
    this.publicIdeBaseUrl = opts.publicIdeBaseUrl?.replace(/\/$/, '') ?? null;
    this.codeServerImage = opts.codeServerImage ?? 'codercom/code-server:latest';
    this.readinessTimeoutMs = opts.readinessTimeoutMs ?? READY_TIMEOUT_MS;
    this.readinessPollMs = opts.readinessPollMs ?? READY_POLL_MS;
  }

  /** The browser-facing IDE URL for a session (raw id or provider ref). */
  ideUrlFor(sessionId: string): string {
    const host = this.hostFor(sessionId);
    if (this.publicIdeBaseUrl) return `${this.publicIdeBaseUrl}/lab/${host}/`;
    return `${this.scheme}://${host}/`;
  }

  async provision(spec: LabSpec): Promise<SessionHandle> {
    if (spec.runtime_tier !== 'tier_2_container') {
      throw new LabProviderError(
        `PodProvider only serves tier_2_container; got ${spec.runtime_tier}`,
        400,
      );
    }

    const ns = namespaceFor(spec.session_id);
    const startedAt = new Date().toISOString();
    const resources = spec.resource_limits ?? { cpu: '500m', memory: '1Gi' };

    await this.cluster.apply(namespaceManifest(ns, spec));
    await this.cluster.apply(pvcManifest(ns));
    await this.cluster.apply(podManifest(ns, this.codeServerImage, resources, spec));
    await this.cluster.apply(serviceManifest(ns));
    await this.cluster.apply(ingressManifest(ns, this.hostFor(spec.session_id)));

    const ideUrl = this.ideUrlFor(spec.session_id);
    const ingressUrl = `${this.scheme}://${this.hostFor(spec.session_id)}/`;
    const ready = await this.awaitIde(ingressUrl);

    return {
      session_id: spec.session_id,
      status: ready ? 'ACTIVE' : 'WARM',
      tier: 'tier_2_container',
      ide_url: ideUrl,
      provider_ref: ns,
      started_at: startedAt,
      last_activity_at: new Date().toISOString(),
      ttl_seconds: spec.ttl_seconds,
    };
  }

  /** `sessionId` here is the provider_ref (the namespace name). */
  async status(sessionId: string): Promise<SessionHandle | null> {
    const ns = namespaceFor(sessionId);
    const pod = await this.cluster.get('Pod', 'code-server', ns);
    if (pod === null) {
      // No pod: either the namespace is gone (terminated) or the pod has not
      // been created yet. Distinguish by asking for the namespace itself.
      const existingNs = await this.cluster.get('Namespace', ns, '');
      if (existingNs === null) return null;
    }
    return {
      session_id: sessionId,
      status: podReady(pod) ? 'ACTIVE' : 'WARM',
      tier: 'tier_2_container',
      ide_url: this.ideUrlFor(sessionId),
      provider_ref: ns,
      started_at:
        toIso(readPath(pod, ['metadata', 'creationTimestamp'])) ?? new Date().toISOString(),
      last_activity_at: new Date().toISOString(),
      ttl_seconds: 1800,
    };
  }

  /** Pods have no TTL API; liveness is observed by reading the pod. */
  async heartbeat(sessionId: string): Promise<SessionHandle> {
    const handle = await this.status(sessionId);
    if (!handle) {
      throw new LabProviderError(`Pod session ${sessionId} not found`, 404);
    }
    return handle;
  }

  /** Delete the namespace; the pod, PVC, service and ingress cascade with it. */
  async terminate(sessionId: string): Promise<void> {
    await this.cluster.delete('Namespace', namespaceFor(sessionId), '');
  }

  private hostFor(sessionId: string): string {
    return `${namespaceFor(sessionId)}.${this.opts.allowedHosts}`;
  }

  private async awaitIde(ideUrl: string): Promise<boolean> {
    const deadline = Date.now() + this.readinessTimeoutMs;
    // The ingress may serve a self-signed cert the host fetch rejects, while its
    // plain-HTTP listener still answers; probe both and treat any non-gateway
    // answer as "the backend is serving".
    const candidates = ideUrl.startsWith('https:')
      ? [ideUrl, ideUrl.replace(/^https:/, 'http:')]
      : [ideUrl];
    for (;;) {
      for (const url of candidates) {
        try {
          const res = await this.fetchImpl(url, { method: 'GET', redirect: 'manual' });
          if (res.status < 500) return true;
        } catch {
          // DNS/connection/TLS not ready yet.
        }
      }
      if (Date.now() > deadline) return false;
      await sleep(this.readinessPollMs);
    }
  }
}

// ------------------------------------------------------------------ manifests

export function namespaceFor(sessionId: string): string {
  // provider_ref *is* the namespace, and status/terminate receive that ref
  // back, so accept an already-prefixed name idempotently.
  if (sessionId.startsWith(NAMESPACE_PREFIX)) return sessionId;
  const slug = sessionId
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .slice(0, 40)
    .replace(/^-+|-+$/g, '');
  return `${NAMESPACE_PREFIX}${slug || 'session'}`;
}

function labels(sessionId: string): Record<string, string> {
  return {
    'app.kubernetes.io/name': 'tenxlab-lab',
    'app.kubernetes.io/managed-by': 'tenxlab-lab-operator',
    'tenxlab.io/session': sessionId,
  };
}

function namespaceManifest(ns: string, spec: LabSpec): Record<string, unknown> {
  return {
    apiVersion: 'v1',
    kind: 'Namespace',
    metadata: {
      name: ns,
      labels: { ...labels(spec.session_id), 'tenxlab.io/tier': spec.runtime_tier },
      annotations: {
        'tenxlab.io/tenant': spec.tenant_id,
        'tenxlab.io/user': spec.user_id,
        'tenxlab.io/exercise': spec.exercise_id,
      },
    },
  };
}

function pvcManifest(ns: string): Record<string, unknown> {
  return {
    apiVersion: 'v1',
    kind: 'PersistentVolumeClaim',
    metadata: { name: 'workspace', namespace: ns },
    spec: {
      accessModes: ['ReadWriteOnce'],
      resources: { requests: { storage: '1Gi' } },
    },
  };
}

function podManifest(
  ns: string,
  image: string,
  resources: { cpu: string; memory: string },
  spec: LabSpec,
): Record<string, unknown> {
  return {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: { name: 'code-server', namespace: ns, labels: labels(spec.session_id) },
    spec: {
      securityContext: { runAsNonRoot: true, runAsUser: 1000, fsGroup: 1000 },
      containers: [
        {
          name: 'code-server',
          image,
          ports: [{ containerPort: PORT }],
          env: [
            { name: 'TENXLAB_SESSION', value: spec.session_id },
            { name: 'TENXLAB_EXERCISE', value: spec.exercise_id },
            // code-server serves unauthenticated inside the pod; the ingress and
            // the LMS session are the access boundary (see ARCHITECTURE.md 8.4).
            { name: 'PASSWORD', value: 'tenxlab' },
          ],
          resources: {
            requests: { cpu: resources.cpu, memory: resources.memory },
            limits: { cpu: resources.cpu, memory: resources.memory },
          },
          volumeMounts: [{ name: 'workspace', mountPath: '/home/coder/project' }],
          readinessProbe: {
            httpGet: { path: '/healthz', port: PORT },
            initialDelaySeconds: 3,
            periodSeconds: 3,
          },
        },
      ],
      volumes: [{ name: 'workspace', persistentVolumeClaim: { claimName: 'workspace' } }],
    },
  };
}

function serviceManifest(ns: string): Record<string, unknown> {
  return {
    apiVersion: 'v1',
    kind: 'Service',
    metadata: { name: 'code-server', namespace: ns },
    spec: {
      selector: { 'app.kubernetes.io/name': 'tenxlab-lab' },
      ports: [{ port: PORT, targetPort: PORT }],
    },
  };
}

function ingressManifest(ns: string, host: string): Record<string, unknown> {
  return {
    apiVersion: 'networking.k8s.io/v1',
    kind: 'Ingress',
    metadata: { name: 'code-server', namespace: ns },
    spec: {
      // Match KubeLab's agent ingress class so tier-2 shares the same gateway.
      ingressClassName: process.env.TENXLAB_INGRESS_CLASS || 'nginx',
      rules: [
        {
          host,
          http: {
            paths: [
              {
                path: '/',
                pathType: 'Prefix',
                backend: { service: { name: 'code-server', port: { number: PORT } } },
              },
            ],
          },
        },
      ],
    },
  };
}

// ------------------------------------------------------------------- helpers

function podReady(pod: Record<string, unknown> | null): boolean {
  const conditions = readPath(pod, ['status', 'conditions']);
  if (!Array.isArray(conditions)) return false;
  return conditions.some(
    (c) =>
      typeof c === 'object' &&
      c !== null &&
      (c as Record<string, unknown>)['type'] === 'Ready' &&
      (c as Record<string, unknown>)['status'] === 'True',
  );
}

function readPath(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (typeof cur !== 'object' || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function toIso(value: unknown): string | undefined {
  if (typeof value !== 'string' || value === '') return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
