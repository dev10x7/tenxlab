import type { LabSpec, SessionHandle } from '@tenxlab/contracts';
import { LabProviderError, type LabProvider } from './types';

export interface KubeLabAdapterOptions {
  /** Base URL of the KubeLab control plane, e.g. https://kubelab.example.com */
  baseUrl: string;
  /** Service token KubeLab expects on the control API (not the launch JWT). */
  apiToken?: string;
  /** Injected for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Tier -> KubeLab cluster profile name. */
  tierProfiles?: Partial<Record<LabSpec['runtime_tier'], string>>;
}

const DEFAULT_PROFILES: Record<string, string> = {
  tier_1_microvm: 'kata-microvm',
  tier_2_container: 'docker-dind',
  tier_3_vcluster: 'vcluster-k8s',
};

/**
 * KubeLab adapter. Speaks to KubeLab's control API and maps its session model
 * onto our provider-neutral SessionHandle.
 *
 * Integration contract (see ARCHITECTURE.md §5.2 / §8.4):
 *   - SSO in:  the user's browser hits GET /launch?token=<RS256 JWT>; KubeLab
 *              verifies the JWT against the LMS JWKS and starts a session whose
 *              `clusterRunning` flag drives provisioning.
 *   - Webhook out: on session completion KubeLab POSTs to the LMS callback_url
 *              with an HMAC-SHA256 signature (x-tenxlab-signature-256).
 *
 * This adapter covers the control-plane calls the LMS makes directly
 * (provision/status/heartbeat/terminate). The interactive launch stays a
 * browser redirect so the launch JWT never transits our servers.
 */
export class KubeLabAdapter implements LabProvider {
  readonly name = 'kubelab';
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly profiles: Record<string, string>;

  constructor(private readonly opts: KubeLabAdapterOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.profiles = { ...DEFAULT_PROFILES, ...(opts.tierProfiles ?? {}) };
  }

  /** Build the browser-facing launch URL for a pre-minted launch JWT. */
  launchUrl(launchToken: string): string {
    return `${this.baseUrl}/launch?token=${encodeURIComponent(launchToken)}`;
  }

  async provision(spec: LabSpec): Promise<SessionHandle> {
    const body = {
      externalSessionId: spec.session_id,
      tenantId: spec.tenant_id,
      userId: spec.user_id,
      exerciseSlug: spec.exercise_id,
      profile: this.profiles[spec.runtime_tier] ?? 'docker-dind',
      image: spec.image,
      resources: spec.resource_limits,
      ttlSeconds: spec.ttl_seconds,
      networkPolicy: spec.network_policy,
      callbackUrl: undefined,
    };
    const res = await this.request('POST', '/api/sessions', body);
    return this.toHandle(spec, res);
  }

  async status(sessionId: string): Promise<SessionHandle | null> {
    const res = await this.request('GET', `/api/sessions/${encodeURIComponent(sessionId)}`, undefined, true);
    if (res === null) return null;
    return this.toHandle(null, res);
  }

  async heartbeat(sessionId: string): Promise<SessionHandle> {
    const res = await this.request(
      'POST',
      `/api/sessions/${encodeURIComponent(sessionId)}/heartbeat`,
      {},
    );
    return this.toHandle(null, res);
  }

  async terminate(sessionId: string): Promise<void> {
    await this.request(
      'DELETE',
      `/api/sessions/${encodeURIComponent(sessionId)}`,
      undefined,
      true,
    );
  }

  private async request(
    method: string,
    path: string,
    body: unknown,
    allowNotFound = false,
  ): Promise<any> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (this.opts.apiToken) headers['authorization'] = `Bearer ${this.opts.apiToken}`;

    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

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

  private toHandle(spec: LabSpec | null, res: any): SessionHandle {
    const now = new Date().toISOString();
    return {
      session_id: res.externalSessionId ?? res.id ?? spec?.session_id ?? '',
      status: mapStatus(res.status ?? res.clusterRunning),
      tier: (res.tier ?? spec?.runtime_tier ?? 'tier_2_container') as SessionHandle['tier'],
      ide_url: res.ideUrl ?? res.url,
      provider_ref: res.id ?? res.clusterId,
      started_at: res.startedAt ?? now,
      last_activity_at: res.lastActivityAt ?? now,
      ttl_seconds: res.ttlSeconds ?? spec?.ttl_seconds ?? 1800,
    };
  }
}

function mapStatus(raw: unknown): SessionHandle['status'] {
  if (raw === true) return 'ACTIVE';
  if (raw === false) return 'WARM';
  const s = String(raw ?? '').toUpperCase();
  if (s === 'RUNNING' || s === 'ACTIVE' || s === 'READY') return 'ACTIVE';
  if (s === 'WARM' || s === 'PROVISIONING' || s === 'PENDING') return 'WARM';
  if (s === 'IDLE') return 'IDLE';
  if (s === 'TERMINATED' || s === 'STOPPED' || s === 'DELETED') return 'TERMINATED';
  return 'WARM';
}
