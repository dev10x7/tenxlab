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

/**
 * Expose one service from a running session on a public URL (E5 one-click
 * hosting).
 *
 * ByteXL demos a student's backend on a public `bytexl.live` URL. We mirror that
 * by giving one workspace one ingress to one container port — a multi-service
 * app is N independently-exposed workspaces the student wires together, not one
 * composed stack (§1.4). This is a separate seam from `LabProvider` because not
 * every provider can expose a service (a tier-1 Piston run cannot), and a
 * session must already be running before it can be exposed.
 */
export interface ExposeInput {
  /** Provider ref of the running session (e.g. the tier-2 namespace). */
  sessionId: string;
  /** Container port the service listens on, e.g. 5000 for Flask. */
  port: number;
}

export interface ExposedService {
  /** Public URL the service is reachable on. */
  url: string;
  /** The container port the URL fronts. */
  port: number;
}

export interface ServiceExposer {
  /** Human-readable provider id, e.g. "pod". */
  readonly name: string;
  /** Publish the service on `port` and return its public URL. Idempotent. */
  expose(input: ExposeInput): Promise<ExposedService>;
  /** Withdraw a previously-exposed service. A missing service is not an error. */
  unexpose(sessionId: string): Promise<void>;
}

/**
 * Publish a running workspace's files to an external git remote (git publish).
 *
 * ByteXL pushes from the IDE's Source Control tab to the student's own GitHub
 * account. We mirror that with a provider-side job that commits the workspace
 * volume and pushes to a repo the LMS created on the student's behalf, so the
 * LMS holds the student's token only for the duration of the push. Like
 * `ServiceExposer`, this is a separate seam because not every provider can run a
 * push (a tier-1 Piston run cannot) and the workspace must be running.
 */
export interface GitPublishInput {
  /** Provider ref of the running session (e.g. the tier-2 namespace). */
  sessionId: string;
  /** HTTPS remote to push to, e.g. `https://github.com/me/repo.git`. */
  remoteUrl: string;
  /** Branch to push, e.g. `main`. */
  branch: string;
  /** Access token the push authenticates with. */
  token: string;
  /** Commit message for the publish commit. */
  message?: string;
}

export interface GitPublishResult {
  /** The remote URL the code was pushed to. */
  repoUrl: string;
  /** The commit the push produced, when the provider reports one. */
  commitSha?: string;
}

export interface GitPublisher {
  /** Human-readable provider id, e.g. "pod". */
  readonly name: string;
  /** Commit the workspace and push it to `remoteUrl`. */
  publish(input: GitPublishInput): Promise<GitPublishResult>;
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
