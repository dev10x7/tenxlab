import type { LabSpec, SessionHandle } from '@tenxlab/contracts';

/**
 * Provider-neutral contract for the lab execution plane. The LMS never talks to
 * a specific runtime; it talks to a LabProvider. This keeps KubeLab replaceable
 * and lets us route by tier (microVM / container / vcluster).
 */
export interface LabProvider {
  /** Human-readable provider id, e.g. "kubelab". */
  readonly name: string;

  /** Provision a lab session and return a handle once it is reachable. */
  provision(spec: LabSpec): Promise<SessionHandle>;

  /** Fetch current state of a session. */
  status(sessionId: string): Promise<SessionHandle | null>;

  /** Extend the session's TTL (keep-alive from an active IDE). */
  heartbeat(sessionId: string): Promise<SessionHandle>;

  /** Tear down the session and release resources. */
  terminate(sessionId: string): Promise<void>;
}

/** Error thrown when the provider returns a non-2xx response. */
export class LabProviderError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: string,
  ) {
    super(message);
    this.name = 'LabProviderError';
  }
}
