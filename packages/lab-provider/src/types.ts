import type { CodeRunResult, LabSpec, SessionHandle } from '@tenxlab/contracts';

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

/**
 * A single request/response code execution.
 *
 * Tier-1 is *not* a session: the Editor runs one program and gets the result
 * back. That shape does not fit `LabProvider` (which models a long-lived,
 * provisioned sandbox), so it gets its own narrow interface — the same seam
 * idea, sized to the workload.
 */
export interface CodeRunInput {
  /** Piston runtime alias, e.g. `python`, `c++`, `sqlite3`. */
  runtime: string;
  source: string;
  stdin?: string;
  /** Wall-clock limit for the program, in milliseconds. */
  runTimeoutMs?: number;
}

export interface CodeExecutionProvider {
  /** Human-readable provider id, e.g. "piston". */
  readonly name: string;
  /** Run one program to completion and return its output. */
  run(input: CodeRunInput): Promise<CodeRunResult>;
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
