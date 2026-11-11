import type { LabSpec, SessionHandle } from '@tenxlab/contracts';
import { LabProviderError, type LabProvider } from './types';

/** Identity KubeLab needs to materialise a lab user record. */
export interface KubeLabUserDescriptor {
  email: string;
  name: string;
  role?: string;
}

/** Everything KubeLab needs to materialise a lab + exercise for one lesson. */
export interface KubeLabExerciseDescriptor {
  /** Stable key for the KubeLab `labs` record (one lab groups many exercises). */
  labSlug: string;
  labTitle: string;
  exerciseTitle: string;
  /** URLs the KubeLab agent pod fetches at bootstrap/check time. */
  bootstrapUrl: string;
  checkUrl: string;
  docsUrl?: string;
  hintUrl?: string;
  solutionUrl?: string;
}

export interface KubeLabAdapterOptions {
  /** Base URL of the KubeLab control plane, e.g. http://localhost:8090 */
  baseUrl: string;
  /** PocketBase admin credentials; KubeLab's control API is admin-only. */
  adminEmail: string;
  adminPassword: string;
  /** Wildcard base for the per-exercise IDE ingress, e.g. 192.168.49.2.nip.io */
  allowedHosts: string;
  /** Scheme for the IDE URL. minikube's nginx ingress terminates TLS itself. */
  ideScheme?: 'https' | 'http';
  /**
   * Optional public base URL that fronts the per-session ingress hosts, e.g. a
   * gateway at `https://labs.example.com`. When set, browser-facing IDE URLs
   * are emitted as `<base>/lab/<ingress-host>/`, which lets a remote browser
   * reach a cluster whose node IP it cannot route to. Readiness still probes
   * the ingress directly.
   */
  publicIdeBaseUrl?: string;
  /** Maps an LMS exercise slug to its KubeLab lab/exercise definition. */
  resolveExercise(exerciseId: string): KubeLabExerciseDescriptor;
  /** Maps an LMS user id to the KubeLab user to upsert. */
  resolveUser(userId: string): KubeLabUserDescriptor;
  /** Injected for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** How long to wait for the IDE to answer before returning a WARM handle. */
  readinessTimeoutMs?: number;
  readinessPollMs?: number;
}

/**
 * Adapter over KubeLab's real control API.
 *
 * KubeLab is a PocketBase application: there is no bespoke `/api/sessions`
 * endpoint and no JWT/JWKS verification. Provisioning is *record-driven* — the
 * Go backend reacts to record updates:
 *
 *   - PATCH `lab_sessions/{id}` `{ clusterRunning: true }`  -> deploys a Helm
 *     vcluster into namespace `kubelab-<lab>-<user>`.
 *   - PATCH `exercise_sessions/{id}` `{ agentRunning: true }` -> deploys the
 *     agent + code-server pod and two ingresses, then waits for readiness.
 *     This call fails (HTTP 400) until the vcluster pod exists, so it is the
 *     natural "cluster is up" signal and is retried here.
 *
 * The IDE the student opens is the code-server ingress:
 *   `<scheme>://kubelab-<labId>-<exerciseId>-<userId>.<allowedHosts>/`
 */
export class KubeLabAdapter implements LabProvider {
  readonly name = 'kubelab';

  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly scheme: string;
  private readonly publicIdeBaseUrl: string | null;
  private readonly readinessTimeoutMs: number;
  private readonly readinessPollMs: number;
  private adminToken: string | null = null;

  constructor(private readonly opts: KubeLabAdapterOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.scheme = opts.ideScheme ?? 'https';
    this.publicIdeBaseUrl = opts.publicIdeBaseUrl?.replace(/\/$/, '') ?? null;
    this.readinessTimeoutMs = opts.readinessTimeoutMs ?? 180_000;
    this.readinessPollMs = opts.readinessPollMs ?? 3_000;
  }

  /** The browser-facing IDE URL for a lab session. */
  ideUrlFor(labId: string, exerciseId: string, userId: string): string {
    const host = `kubelab-${labId}-${exerciseId}-${userId}.${this.opts.allowedHosts}`;
    if (this.publicIdeBaseUrl) {
      return `${this.publicIdeBaseUrl}/lab/${host}/`;
    }
    return `${this.scheme}://${host}/`;
  }

  /** The ingress URL the IDE is actually served on, for host-side readiness. */
  private ingressUrlFor(labId: string, exerciseId: string, userId: string): string {
    const host = `kubelab-${labId}-${exerciseId}-${userId}.${this.opts.allowedHosts}`;
    return `${this.scheme}://${host}/`;
  }

  async provision(spec: LabSpec): Promise<SessionHandle> {
    if (spec.runtime_tier !== 'tier_3_vcluster') {
      throw new LabProviderError(
        `KubeLab only serves tier_3_vcluster; got ${spec.runtime_tier}`,
        400,
      );
    }

    const user = await this.ensureUser(this.opts.resolveUser(spec.user_id));
    const descriptor = this.opts.resolveExercise(spec.exercise_id);
    const lab = await this.ensureLab(descriptor);
    const exercise = await this.ensureExercise(descriptor, String(lab['id']));

    const startedAt = new Date().toISOString();
    const labSession = await this.findOrCreate(
      'lab_sessions',
      { user: String(user['id']), lab: String(lab['id']) },
      { user: String(user['id']), lab: String(lab['id']), clusterRunning: false },
    );
    const exerciseSession = await this.findOrCreate(
      'exercise_sessions',
      { user: String(user['id']), exercise: String(exercise['id']) },
      { user: String(user['id']), exercise: String(exercise['id']), agentRunning: false },
    );

    // 1. Bring the vcluster up. KubeLab's `clusterRunning` hook is not
    //    idempotent: it re-creates a resource quota and 400s if the namespace
    //    already exists (e.g. the record was lost while the namespace lingered).
    //    The helm release is applied before the quota step, so a 400 here still
    //    means the cluster is up. Step 2 is the real gate, so a failure to flip
    //    the flag is tolerated rather than fatal.
    if (labSession['clusterRunning'] !== true) {
      try {
        await this.patch('lab_sessions', String(labSession['id']), {
          clusterRunning: true,
          startTime: startedAt,
        });
      } catch (err) {
        if (!(err instanceof LabProviderError) || err.status !== 400) throw err;
        // eslint-disable-next-line no-console
        console.warn(
          `[kubelab] cluster start for ${String(labSession['id'])} returned 400; ` +
            'assuming the namespace already exists and continuing to the agent check',
        );
      }
    }

    // 2. Bring the agent + code-server up. KubeLab rejects this until the
    //    vcluster pod exists, so retry until it accepts. Skipped when the
    //    agent is already running.
    if (exerciseSession['agentRunning'] !== true) {
      await this.awaitClusterReady(String(exerciseSession['id']), startedAt);
    }

    // 3. Wait until the IDE actually answers, so the student never lands on a
    //    502 while the ingress propagates. Probe the ingress directly; the
    //    browser-facing URL may differ (see `publicIdeBaseUrl`).
    const ideUrl = this.ideUrlFor(
      String(lab['id']),
      String(exercise['id']),
      String(user['id']),
    );
    const ingressUrl = this.ingressUrlFor(
      String(lab['id']),
      String(exercise['id']),
      String(user['id']),
    );
    const ready = await this.awaitIde(ingressUrl);

    return {
      session_id: spec.session_id,
      status: ready ? 'ACTIVE' : 'WARM',
      tier: 'tier_3_vcluster',
      ide_url: ideUrl,
      provider_ref: String(exerciseSession['id']),
      started_at: startedAt,
      last_activity_at: new Date().toISOString(),
      ttl_seconds: spec.ttl_seconds,
    };
  }

  /** `sessionId` is the provider_ref (KubeLab exercise_session id). */
  async status(sessionId: string): Promise<SessionHandle | null> {
    const row = await this.get('exercise_sessions', sessionId);
    if (row === null) return null;
    const exerciseId = String(row['exercise'] ?? '');
    const exercise = exerciseId ? await this.get('exercises', exerciseId) : null;
    const labId = exercise ? String(exercise['lab'] ?? '') : '';
    const userId = String(row['user'] ?? '');
    const ideUrl =
      labId && exerciseId && userId
        ? this.ideUrlFor(labId, exerciseId, userId)
        : undefined;
    return {
      session_id: sessionId,
      status: row['agentRunning'] === true ? 'ACTIVE' : 'WARM',
      tier: 'tier_3_vcluster',
      ide_url: ideUrl,
      provider_ref: sessionId,
      started_at: toIso(row['startTime']) ?? new Date().toISOString(),
      last_activity_at: toIso(row['updated']) ?? new Date().toISOString(),
      ttl_seconds: 1800,
    };
  }

  /**
   * KubeLab has no TTL/keep-alive API; liveness is observed by reading the
   * record. Refresh and report current state.
   */
  async heartbeat(sessionId: string): Promise<SessionHandle> {
    const handle = await this.status(sessionId);
    if (!handle) {
      throw new LabProviderError(`KubeLab session ${sessionId} not found`, 404);
    }
    return handle;
  }

  /** Tear down the agent and the vcluster for a session. */
  async terminate(sessionId: string): Promise<void> {
    const row = await this.get('exercise_sessions', sessionId);
    if (row === null) return;
    await this.patch('exercise_sessions', sessionId, {
      agentRunning: false,
      endTime: new Date().toISOString(),
    });

    const exerciseId = String(row['exercise'] ?? '');
    const exercise = exerciseId ? await this.get('exercises', exerciseId) : null;
    const labId = exercise ? String(exercise['lab'] ?? '') : '';
    const userId = String(row['user'] ?? '');
    if (!labId || !userId) return;

    const labSession = await this.findFirst('lab_sessions', { user: userId, lab: labId });
    if (labSession) {
      await this.patch('lab_sessions', String(labSession['id']), {
        clusterRunning: false,
        endTime: new Date().toISOString(),
      });
    }
  }

  // ---------------------------------------------------------------- internals

  private async awaitClusterReady(exerciseSessionId: string, startTime: string): Promise<void> {
    const deadline = Date.now() + this.readinessTimeoutMs;
    for (;;) {
      try {
        await this.patch('exercise_sessions', exerciseSessionId, {
          agentRunning: true,
          startTime,
        });
        return;
      } catch (err) {
        if (!(err instanceof LabProviderError) || err.status !== 400) throw err;
        if (Date.now() > deadline) {
          throw new LabProviderError(
            'Timed out waiting for the KubeLab vcluster to become ready',
            504,
            err.body,
          );
        }
        await sleep(this.readinessPollMs);
      }
    }
  }

  private async awaitIde(ideUrl: string): Promise<boolean> {
    const deadline = Date.now() + this.readinessTimeoutMs;
    // The ingress may serve a self-signed cert (minikube) that the host fetch
    // rejects, while its plain-HTTP listener answers with a redirect. Probe the
    // http variant too and treat any non-gateway answer as "the backend is
    // serving" — a 308 to https is a perfectly good readiness signal.
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

  private async ensureUser(descriptor: KubeLabUserDescriptor) {
    const existing = await this.findFirst('users', { email: descriptor.email });
    if (existing) return existing;
    const password = `tx-${Math.random().toString(36).slice(2)}-${Date.now()}`;
    return this.create('users', {
      email: descriptor.email,
      password,
      passwordConfirm: password,
      name: descriptor.name,
      role: kubelabRole(descriptor.role),
    });
  }

  private async ensureLab(descriptor: KubeLabExerciseDescriptor) {
    const existing = await this.findFirst('labs', { title: descriptor.labTitle });
    if (existing) return existing;
    return this.create('labs', {
      title: descriptor.labTitle,
      description: `TenXLab lab group: ${descriptor.labSlug}`,
    });
  }

  private async ensureExercise(descriptor: KubeLabExerciseDescriptor, labId: string) {
    const existing = await this.findFirst('exercises', {
      title: descriptor.exerciseTitle,
      lab: labId,
    });
    const data: Record<string, unknown> = {
      title: descriptor.exerciseTitle,
      description: descriptor.exerciseTitle,
      lab: labId,
      bootstrap: descriptor.bootstrapUrl,
      check: descriptor.checkUrl,
    };
    if (descriptor.docsUrl) data['docs'] = descriptor.docsUrl;
    if (descriptor.hintUrl) data['hint'] = descriptor.hintUrl;
    if (descriptor.solutionUrl) data['solution'] = descriptor.solutionUrl;
    if (existing) return this.patch('exercises', String(existing['id']), data);
    return this.create('exercises', data);
  }

  private async findOrCreate(
    collection: string,
    filter: Record<string, string>,
    data: Record<string, unknown>,
  ) {
    const existing = await this.findFirst(collection, filter);
    if (existing) return existing;
    return this.create(collection, data);
  }

  private async findFirst(collection: string, filter: Record<string, string>) {
    const clause = Object.entries(filter)
      .map(([k, v]) => `${k}='${String(v).replace(/'/g, "\\'")}'`)
      .join(' && ');
    const res = await this.request(
      'GET',
      `/api/collections/${collection}/records?perPage=1&filter=${encodeURIComponent(clause)}`,
    );
    const items = (res as { items?: unknown[] }).items ?? [];
    return (items[0] as Record<string, unknown> | undefined) ?? null;
  }

  private async get(collection: string, id: string) {
    const res = await this.request(
      'GET',
      `/api/collections/${collection}/records/${encodeURIComponent(id)}`,
      undefined,
      true,
    );
    return res as Record<string, unknown> | null;
  }

  private async create(collection: string, data: Record<string, unknown>) {
    const res = await this.request('POST', `/api/collections/${collection}/records`, data);
    return res as Record<string, unknown>;
  }

  private async patch(collection: string, id: string, data: Record<string, unknown>) {
    const res = await this.request(
      'PATCH',
      `/api/collections/${collection}/records/${encodeURIComponent(id)}`,
      data,
    );
    return res as Record<string, unknown>;
  }

  private async adminAuth(): Promise<string> {
    const res = await this.fetchImpl(`${this.baseUrl}/api/admins/auth-with-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        identity: this.opts.adminEmail,
        password: this.opts.adminPassword,
      }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new LabProviderError(
        `KubeLab admin auth failed (${res.status})`,
        res.status,
        text,
      );
    }
    const body = (await res.json()) as { token?: string };
    if (!body.token) {
      throw new LabProviderError('KubeLab admin auth returned no token', 500);
    }
    return body.token;
  }

  private async request(
    method: string,
    path: string,
    body?: unknown,
    allowNotFound = false,
    retryOnAuth = true,
  ): Promise<unknown> {
    if (!this.adminToken) this.adminToken = await this.adminAuth();
    const headers: Record<string, string> = {
      accept: 'application/json',
      authorization: this.adminToken,
    };
    if (body !== undefined) headers['content-type'] = 'application/json';

    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (res.status === 401 && retryOnAuth) {
      this.adminToken = null;
      return this.request(method, path, body, allowNotFound, false);
    }
    if (allowNotFound && res.status === 404) return null;
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new LabProviderError(
        `KubeLab ${method} ${path} failed (${res.status})`,
        res.status,
        text,
      );
    }
    if (res.status === 204) return {};
    return res.json().catch(() => ({}));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * KubeLab's `users.role` is a select restricted to `user`/`admin`; anything else
 * is rejected with a 400. LMS roles (student/instructor) are not meaningful to
 * KubeLab, so map every non-admin role to `user`.
 */
function kubelabRole(role: string | undefined): 'user' | 'admin' {
  return role === 'admin' ? 'admin' : 'user';
}

function toIso(value: unknown): string | undefined {
  if (typeof value !== 'string' || value === '') return undefined;
  const normalized = value.includes('T') ? value : value.replace(' ', 'T') + 'Z';
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}
