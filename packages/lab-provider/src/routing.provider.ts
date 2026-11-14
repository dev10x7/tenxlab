import type { LabSpec, SessionHandle } from '@tenxlab/contracts';
import {
  LabProviderError,
  type ExposedService,
  type ExposeInput,
  type LabProvider,
  type ServiceExposer,
} from './types';

/**
 * Dispatch a lab session to the provider that owns its tier.
 *
 * KubeLab serves tier-3 only (ADR-8) and the pod provider serves tier-2; the
 * LMS should not care which one answers. This keeps the routing decision in one
 * place and lets a single `PROVIDER` injection serve every tier.
 *
 * Tier-1 (`tier_1_microvm`) is deliberately absent: a DSA run is a
 * request/response `CodeExecutionProvider` (Piston), not a session. A tier-1
 * *lab* would need a pod-based runtime we do not yet run, so it fails loudly
 * rather than silently borrowing tier-2 capacity.
 *
 * It also implements `ServiceExposer` (E5): only some providers can publish a
 * service, so `expose`/`unexpose` delegate to whichever route supports it. A
 * deploy is a tier-2 (pod) concern today, so the tier-2 provider answers.
 */
export class RoutingProvider implements LabProvider, ServiceExposer {
  readonly name = 'routing';

  constructor(
    private readonly routes: Partial<Record<string, LabProvider>>,
    private readonly fallback?: LabProvider,
  ) {}

  private select(spec: LabSpec): LabProvider {
    const provider = this.routes[spec.runtime_tier] ?? this.fallback;
    if (!provider) {
      throw new LabProviderError(
        `No lab provider is configured for tier ${spec.runtime_tier}`,
        503,
      );
    }
    return provider;
  }

  async provision(spec: LabSpec): Promise<SessionHandle> {
    return this.select(spec).provision(spec);
  }

  /**
   * `status`/`heartbeat`/`terminate` receive only a provider ref, not the tier,
   * so try each provider in turn. A session belongs to exactly one provider, so
   * the first that recognises the ref wins; refs that no provider knows are
   * reported as not found.
   */
  async status(sessionId: string): Promise<SessionHandle | null> {
    for (const provider of this.all()) {
      const handle = await provider.status(sessionId).catch(() => null);
      if (handle) return handle;
    }
    return null;
  }

  async heartbeat(sessionId: string): Promise<SessionHandle> {
    for (const provider of this.all()) {
      const handle = await provider.status(sessionId).catch(() => null);
      if (handle) return provider.heartbeat(sessionId);
    }
    throw new LabProviderError(`No lab provider owns session ${sessionId}`, 404);
  }

  async terminate(sessionId: string): Promise<void> {
    for (const provider of this.all()) {
      const handle = await provider.status(sessionId).catch(() => null);
      if (handle) {
        await provider.terminate(sessionId);
        return;
      }
    }
  }

  private all(): LabProvider[] {
    const seen = new Set<LabProvider>();
    const list: LabProvider[] = [];
    for (const provider of [...Object.values(this.routes), this.fallback]) {
      if (provider && !seen.has(provider)) {
        seen.add(provider);
        list.push(provider);
      }
    }
    return list;
  }

  /** The first configured provider that can publish a service, if any. */
  private exposer(): ServiceExposer | null {
    for (const provider of this.all()) {
      if (isExposer(provider)) return provider;
    }
    return null;
  }

  async expose(input: ExposeInput): Promise<ExposedService> {
    const exposer = this.exposer();
    if (!exposer) {
      throw new LabProviderError('No lab provider can expose a service', 503);
    }
    return exposer.expose(input);
  }

  async unexpose(sessionId: string): Promise<void> {
    // Withdraw from every capable provider: the session may belong to any one.
    for (const provider of this.all()) {
      if (isExposer(provider)) await provider.unexpose(sessionId);
    }
  }
}

/** Structural check: does this provider implement `ServiceExposer`? */
function isExposer(provider: LabProvider): provider is LabProvider & ServiceExposer {
  const candidate = provider as Partial<ServiceExposer>;
  return typeof candidate.expose === 'function' && typeof candidate.unexpose === 'function';
}
