import type { LabSpec, SessionHandle } from '@tenxlab/contracts';
import {
  LabProviderError,
  type ExposedService,
  type ExposeInput,
  type GitPublisher,
  type GitPublishInput,
  type GitPublishResult,
  type LabProvider,
  type ReadWorkspaceFilesInput,
  type ServiceExposer,
  type WorkspaceFile,
  type WorkspaceReader,
} from './types';

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
  /** Read a pod's logs (a failed/absent pod returns an empty string). */
  logs(namespace: string, podName: string, container?: string): Promise<string>;
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
  /** How long terminate waits for a deleted namespace to actually disappear. */
  terminateTimeoutMs?: number;
  terminatePollMs?: number;
  /** How long publish waits for the git-push job to complete. */
  gitPushTimeoutMs?: number;
  gitPushPollMs?: number;
  /** How long a workspace file read waits for its job to complete. */
  readTimeoutMs?: number;
  readPollMs?: number;
  /** Injected for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

const NAMESPACE_PREFIX = 'tenxlab-t2-';
const PORT = 8080;
const READY_TIMEOUT_MS = 90_000;
const READY_POLL_MS = 2_000;
const TERMINATE_TIMEOUT_MS = 60_000;
const TERMINATE_POLL_MS = 1_000;
const GIT_PUSH_TIMEOUT_MS = 120_000;
const GIT_PUSH_POLL_MS = 2_000;
const GIT_PUSH_JOB = 'git-publish';
const GIT_PUSH_IMAGE = 'alpine/git:latest';
const READ_JOB = 'workspace-read';
const READ_JOB_IMAGE = 'python:3.12-alpine';
const READ_TIMEOUT_MS = 60_000;
const READ_POLL_MS = 2_000;

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
export class PodProvider implements LabProvider, ServiceExposer, GitPublisher, WorkspaceReader {
  readonly name = 'pod';

  private readonly cluster: ClusterClient;
  private readonly fetchImpl: typeof fetch;
  private readonly scheme: string;
  private readonly publicIdeBaseUrl: string | null;
  private readonly codeServerImage: string;
  private readonly readinessTimeoutMs: number;
  private readonly readinessPollMs: number;
  private readonly terminateTimeoutMs: number;
  private readonly terminatePollMs: number;
  private readonly gitPushTimeoutMs: number;
  private readonly gitPushPollMs: number;
  private readonly readTimeoutMs: number;
  private readonly readPollMs: number;

  constructor(private readonly opts: PodProviderOptions) {
    this.cluster = opts.cluster;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.scheme = opts.ideScheme ?? 'https';
    this.publicIdeBaseUrl = opts.publicIdeBaseUrl?.replace(/\/$/, '') ?? null;
    this.codeServerImage = opts.codeServerImage ?? 'codercom/code-server:latest';
    this.readinessTimeoutMs = opts.readinessTimeoutMs ?? READY_TIMEOUT_MS;
    this.readinessPollMs = opts.readinessPollMs ?? READY_POLL_MS;
    this.terminateTimeoutMs = opts.terminateTimeoutMs ?? TERMINATE_TIMEOUT_MS;
    this.terminatePollMs = opts.terminatePollMs ?? TERMINATE_POLL_MS;
    this.gitPushTimeoutMs = opts.gitPushTimeoutMs ?? GIT_PUSH_TIMEOUT_MS;
    this.gitPushPollMs = opts.gitPushPollMs ?? GIT_PUSH_POLL_MS;
    this.readTimeoutMs = opts.readTimeoutMs ?? READ_TIMEOUT_MS;
    this.readPollMs = opts.readPollMs ?? READ_POLL_MS;
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
    const ns = namespaceFor(sessionId);
    await this.cluster.delete('Namespace', ns, '');
    // Deletion is asynchronous: the namespace lingers in Terminating while its
    // resources finalise. A resume (re-fork) that re-applies immediately would
    // race that state, so block until the namespace is actually gone.
    const deadline = Date.now() + this.terminateTimeoutMs;
    while (Date.now() < deadline) {
      if ((await this.cluster.get('Namespace', ns, '')) === null) return;
      await new Promise((r) => setTimeout(r, this.terminatePollMs));
    }
  }

  private hostFor(sessionId: string): string {
    return `${namespaceFor(sessionId)}.${this.opts.allowedHosts}`;
  }

  /** The deploy host for a session's exposed service. */
  private deployHostFor(sessionId: string): string {
    return `${namespaceFor(sessionId)}-deploy.${this.opts.allowedHosts}`;
  }

  /** The browser-facing URL for a session's deployed service. */
  deployUrlFor(sessionId: string): string {
    const host = this.deployHostFor(sessionId);
    if (this.publicIdeBaseUrl) return `${this.publicIdeBaseUrl}/lab/${host}/`;
    return `${this.scheme}://${host}/`;
  }

  /**
   * Publish the running workspace's service on a public URL (E5). One workspace
   * exposes one service: a Service selecting the workspace pod's label plus an
   * Ingress under a `-deploy` host, reusing the same ingress class as the IDE so
   * both share a gateway. Idempotent — re-deploying re-applies the same objects.
   */
  async expose(input: ExposeInput): Promise<ExposedService> {
    const ns = namespaceFor(input.sessionId);
    const pod = await this.cluster.get('Pod', 'code-server', ns);
    if (pod === null) {
      throw new LabProviderError(
        `Workspace ${input.sessionId} is not running; nothing to expose`,
        409,
      );
    }
    const host = this.deployHostFor(input.sessionId);
    await this.cluster.apply(deployServiceManifest(ns, input.port));
    await this.cluster.apply(deployIngressManifest(ns, host, input.port));
    return { url: this.deployUrlFor(input.sessionId), port: input.port };
  }

  /** Withdraw the exposed service. Deleting the Ingress removes public access. */
  async unexpose(sessionId: string): Promise<void> {
    const ns = namespaceFor(sessionId);
    await this.cluster.delete('Ingress', 'deploy', ns);
    await this.cluster.delete('Service', 'deploy', ns);
  }

  /**
   * Publish the workspace's files to an external git remote (git publish).
   *
   * The workspace volume is mounted into a short-lived Job that commits the
   * tracked files and pushes them to `remoteUrl` with the student's token. The
   * token never leaves the cluster: it is passed only to the Job's pod. The Job
   * is deleted when the push finishes (success or failure) so nothing lingers.
   */
  async publish(input: GitPublishInput): Promise<GitPublishResult> {
    const ns = namespaceFor(input.sessionId);
    const pod = await this.cluster.get('Pod', 'code-server', ns);
    if (pod === null) {
      throw new LabProviderError(
        `Workspace ${input.sessionId} is not running; nothing to publish`,
        409,
      );
    }
    const branch = input.branch || 'main';
    const message = input.message || 'Publish from TenXLab';
    await this.cluster.delete('Job', GIT_PUSH_JOB, ns);
    await this.cluster.apply(gitPushJobManifest(ns, input, branch, message));

    const result = await this.awaitGitPush(ns, branch);
    await this.cluster.delete('Job', GIT_PUSH_JOB, ns);
    if (!result.ok) {
      throw new LabProviderError(`git push failed: ${result.reason}`, 502);
    }
    return { repoUrl: input.remoteUrl };
  }

  /**
   * Wait for the push Job to succeed or fail. A Job reports a `Complete` or
   * `Failed` condition; either resolves the wait. A timeout is treated as a
   * failure so the caller is never left hanging on a wedged push.
   */
  private async awaitGitPush(
    ns: string,
    branch: string,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    const deadline = Date.now() + this.gitPushTimeoutMs;
    for (;;) {
      const job = await this.cluster.get('Job', GIT_PUSH_JOB, ns);
      const condition = jobCondition(job);
      if (condition === 'Complete') return { ok: true };
      if (condition === 'Failed') {
        return { ok: false, reason: await this.gitPushLog(ns) };
      }
      if (Date.now() > deadline) {
        return { ok: false, reason: `timed out pushing to ${branch}` };
      }
      await sleep(this.gitPushPollMs);
    }
  }

  /** Best-effort failure detail from the Job pod, for an actionable error. */
  private async gitPushLog(ns: string): Promise<string> {
    const pod = await this.cluster.get('Pod', GIT_PUSH_JOB, ns);
    const reason = readPath(pod, ['status', 'containerStatuses']);
    if (Array.isArray(reason)) {
      for (const status of reason) {
        const terminated = (status as Record<string, unknown>)?.state;
        const msg = readPath(terminated, ['terminated', 'message']);
        if (typeof msg === 'string' && msg) return msg;
      }
    }
    return 'the push job reported a failure';
  }

  /**
   * Read the workspace's matching source files (auto-evaluation).
   *
   * The volume is mounted into a short-lived Job that emits a JSON envelope
   * (`{ files: [{ path, content }] }`) to stdout; the Job's pod logs are read
   * back and parsed. The workspace must be running — a stopped fork has no pod,
   * so the caller must start it (resume the fork) before evaluating. The Job is
   * deleted when the read finishes so nothing lingers.
   */
  async readWorkspaceFiles(input: ReadWorkspaceFilesInput): Promise<WorkspaceFile[]> {
    const ns = namespaceFor(input.sessionId);
    const pod = await this.cluster.get('Pod', 'code-server', ns);
    if (pod === null) {
      throw new LabProviderError(
        `Workspace ${input.sessionId} is not running; nothing to read`,
        409,
      );
    }
    await this.cluster.delete('Job', READ_JOB, ns);
    await this.cluster.apply(readJobManifest(ns, input));

    const envelope = await this.awaitRead(ns);
    await this.cluster.delete('Job', READ_JOB, ns);
    if (!envelope.ok) {
      throw new LabProviderError(`workspace read failed: ${envelope.reason}`, 502);
    }
    return envelope.files;
  }

  /** Wait for the read Job, then parse its JSON envelope from the pod logs. */
  private async awaitRead(
    ns: string,
  ): Promise<{ ok: true; files: WorkspaceFile[] } | { ok: false; reason: string }> {
    const deadline = Date.now() + this.readTimeoutMs;
    for (;;) {
      const job = await this.cluster.get('Job', READ_JOB, ns);
      const condition = jobCondition(job);
      if (condition === 'Complete') {
        const raw = await this.cluster.logs(ns, READ_JOB);
        return parseReadEnvelope(raw);
      }
      if (condition === 'Failed') {
        return { ok: false, reason: 'the read job reported a failure' };
      }
      if (Date.now() > deadline) {
        return { ok: false, reason: 'timed out reading the workspace' };
      }
      await sleep(this.readPollMs);
    }
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

/**
 * The Service a Deploy exposes: it selects the workspace's code-server pod but
 * forwards to the student's own service port, so the ingress fronts the app the
 * student runs rather than the IDE.
 */
function deployServiceManifest(ns: string, port: number): Record<string, unknown> {
  return {
    apiVersion: 'v1',
    kind: 'Service',
    metadata: { name: 'deploy', namespace: ns },
    spec: {
      selector: { 'app.kubernetes.io/name': 'tenxlab-lab' },
      ports: [{ port, targetPort: port }],
    },
  };
}

/** The public Ingress for a deployed service, under a `-deploy` host. */
function deployIngressManifest(
  ns: string,
  host: string,
  port: number,
): Record<string, unknown> {
  return {
    apiVersion: 'networking.k8s.io/v1',
    kind: 'Ingress',
    metadata: { name: 'deploy', namespace: ns },
    spec: {
      ingressClassName: process.env.TENXLAB_INGRESS_CLASS || 'nginx',
      rules: [
        {
          host,
          http: {
            paths: [
              {
                path: '/',
                pathType: 'Prefix',
                backend: { service: { name: 'deploy', port: { number: port } } },
              },
            ],
          },
        },
      ],
    },
  };
}

/**
 * The Job that commits and pushes the workspace volume.
 *
 * It mounts the same `workspace` PVC the code-server pod uses, so it pushes
 * exactly the files the student sees in the IDE. The push uses a tokenized
 * remote (`https://x-access-token:<token>@host/...`) passed via env, so the
 * token does not appear in the process arguments. The Job is deleted by
 * `publish` once it finishes.
 */
function gitPushJobManifest(
  ns: string,
  input: GitPublishInput,
  branch: string,
  message: string,
): Record<string, unknown> {
  const tokenizedRemote = tokenizeRemote(input.remoteUrl, input.token);
  const script = [
    'set -e',
    'cd /workspace',
    'git config --global user.email "student@tenxlab.local"',
    'git config --global user.name "TenXLab Student"',
    'git init -q',
    `git checkout -q -B ${shellQuote(branch)}`,
    'git add -A',
    'git commit -q -m "$GIT_MESSAGE" || true',
    `git push -q "$GIT_REMOTE" ${shellQuote(branch)} --force`,
  ].join('\n');
  return {
    apiVersion: 'batch/v1',
    kind: 'Job',
    metadata: {
      name: GIT_PUSH_JOB,
      namespace: ns,
      labels: labels(input.sessionId),
    },
    spec: {
      backoffLimit: 0,
      ttlSecondsAfterFinished: 300,
      template: {
        metadata: { labels: labels(input.sessionId) },
        spec: {
          restartPolicy: 'Never',
          containers: [
            {
              name: 'git-push',
              image: GIT_PUSH_IMAGE,
              command: ['/bin/sh', '-c'],
              args: [script],
              env: [
                { name: 'GIT_MESSAGE', value: message },
                { name: 'GIT_REMOTE', value: tokenizedRemote },
              ],
              volumeMounts: [{ name: 'workspace', mountPath: '/workspace' }],
            },
          ],
          volumes: [
            { name: 'workspace', persistentVolumeClaim: { claimName: 'workspace' } },
          ],
        },
      },
    },
  };
}

/** Insert an access token into an HTTPS remote so the push authenticates. */
export function tokenizeRemote(remoteUrl: string, token: string): string {
  if (!remoteUrl.startsWith('https://')) return remoteUrl;
  return remoteUrl.replace('https://', `https://x-access-token:${token}@`);
}

/**
 * The Job that reads the workspace volume and prints a JSON envelope.
 *
 * It mounts the same `workspace` PVC the code-server pod uses, walks it for the
 * requested extensions, and writes `{"files":[{path,content}]}` to stdout. The
 * envelope is one line so the provider can read it back from the pod logs.
 * Paths are emitted relative to `/workspace`; binary-ish and oversized files
 * are skipped by the `awk` size guard.
 */
function readJobManifest(ns: string, input: ReadWorkspaceFilesInput): Record<string, unknown> {
  const maxFileBytes = Math.max(1, Math.floor(input.maxFileBytes ?? 256 * 1024));
  const maxTotalBytes = Math.max(1, Math.floor(input.maxTotalBytes ?? 4 * 1024 * 1024));
  const extensions = input.extensions.map((e) => e.replace(/^\./, '')).filter(Boolean);
  const script = [
    'set -e',
    'cd /workspace',
    'export EXTS="$EXTS" MAXF="$MAXF" MAXT="$MAXT"',
    'python3 - <<\'PY\'',
    'import json, os, sys',
    'exts = {("." + e) for e in os.environ["EXTS"].split(",") if e}',
    'maxf = int(os.environ["MAXF"]); maxt = int(os.environ["MAXT"])',
    'skip = {".git", "node_modules", "venv", ".venv", "__pycache__", "dist", "build", "target", ".cache"}',
    'out = []; total = 0',
    'for root, dirs, files in os.walk("."):',
    '    dirs[:] = [d for d in dirs if d not in skip and not d.startswith(".")]',
    '    for name in files:',
    '        if os.path.splitext(name)[1] not in exts: continue',
    '        p = os.path.join(root, name)',
    '        try:',
    '            if os.path.getsize(p) > maxf: continue',
    '            with open(p, "r", encoding="utf-8", errors="strict") as fh:',
    '                content = fh.read()',
    '        except (OSError, UnicodeDecodeError):',
    '            continue',
    '        total += len(content)',
    '        if total > maxt: break',
    '        out.append({"path": os.path.relpath(p, "."), "content": content})',
    '    if total > maxt: break',
    'print(json.dumps({"files": out}))',
    'PY',
  ].join('\n');
  return {
    apiVersion: 'batch/v1',
    kind: 'Job',
    metadata: {
      name: READ_JOB,
      namespace: ns,
      labels: { app: 'tenxlab', role: 'workspace-read' },
    },
    spec: {
      backoffLimit: 0,
      ttlSecondsAfterFinished: 300,
      template: {
        metadata: { labels: { app: 'tenxlab', role: 'workspace-read' } },
        spec: {
          restartPolicy: 'Never',
          containers: [
            {
              name: 'read',
              image: READ_JOB_IMAGE,
              command: ['/bin/sh', '-c'],
              args: [script],
              env: [
                { name: 'EXTS', value: extensions.join(',') },
                { name: 'MAXF', value: String(maxFileBytes) },
                { name: 'MAXT', value: String(maxTotalBytes) },
              ],
              volumeMounts: [{ name: 'workspace', mountPath: '/workspace' }],
            },
          ],
          volumes: [
            { name: 'workspace', persistentVolumeClaim: { claimName: 'workspace' } },
          ],
        },
      },
    },
  };
}

/**
 * Parse the read Job's log output into files. The Job prints one JSON envelope,
 * but Kubernetes may prepend/append unrelated lines, so scan for the last line
 * that parses as an object with a `files` array.
 */
export function parseReadEnvelope(
  raw: string,
): { ok: true; files: WorkspaceFile[] } | { ok: false; reason: string } {
  const lines = raw.split('\n').filter((l) => l.trim().startsWith('{'));
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(lines[i]!) as { files?: unknown };
      if (Array.isArray(parsed.files)) {
        const files: WorkspaceFile[] = [];
        for (const f of parsed.files) {
          const file = f as { path?: unknown; content?: unknown };
          if (typeof file.path === 'string' && typeof file.content === 'string') {
            files.push({ path: file.path, content: file.content });
          }
        }
        return { ok: true, files };
      }
    } catch {
      // Not the envelope line; keep scanning.
    }
  }
  return { ok: false, reason: 'the read job produced no file envelope' };
}

/** Single-quote a shell argument, escaping embedded quotes. */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** A Job's terminal condition type, or null while it is still running. */
function jobCondition(job: Record<string, unknown> | null): string | null {
  const conditions = readPath(job, ['status', 'conditions']);
  if (!Array.isArray(conditions)) return null;
  for (const c of conditions) {
    if (typeof c !== 'object' || c === null) continue;
    const type = (c as Record<string, unknown>)['type'];
    const status = (c as Record<string, unknown>)['status'];
    if (status === 'True' && (type === 'Complete' || type === 'Failed')) {
      return type as string;
    }
  }
  return null;
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
