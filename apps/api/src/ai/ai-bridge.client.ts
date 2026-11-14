/**
 * Minimal client for the TenXLab AI plane (FastAPI).
 *
 * ByteXL auto-evaluates submissions with SonarQube; we mirror that with the
 * in-house `quality.py` analyzer (ADR-13) so the license gate stays
 * permissive-only. Only the one endpoint we need is implemented, so there is no
 * SDK dependency — the same shape as `GitHubClient`.
 */

export interface AiBridgeClientOptions {
  /** Base URL of the AI plane, e.g. `http://localhost:8000`. */
  baseUrl: string;
  /** Injected for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Per-request timeout. */
  timeoutMs?: number;
}

/** One issue the analyzer raised, with the line it points at (when known). */
export interface QualityIssue {
  code: string;
  message: string;
  line: number | null;
}

/** A quality report: a 0-100 score plus the explainable issues behind it. */
export interface QualityReport {
  score: number;
  issueCount: number;
  issues: QualityIssue[];
}

export class AiBridgeError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'AiBridgeError';
  }
}

/** What the evaluation service needs from the AI plane (fakeable in tests). */
export interface QualityAnalyzer {
  scoreQuality(input: {
    tenantId: string;
    projectId: string;
    studentId: string;
    code: string;
  }): Promise<QualityReport>;
}

const DEFAULT_TIMEOUT_MS = 15_000;

export class AiBridgeClient implements QualityAnalyzer {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: AiBridgeClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** Score a body of source code with the AI plane's quality analyzer. */
  async scoreQuality(input: {
    tenantId: string;
    projectId: string;
    studentId: string;
    code: string;
  }): Promise<QualityReport> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/v1/quality/score`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          tenant_id: input.tenantId,
          project_id: input.projectId,
          student_id: input.studentId,
          code: input.code,
        }),
        signal: controller.signal,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'request failed';
      throw new AiBridgeError(`AI plane unreachable: ${reason}`, 0);
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      throw new AiBridgeError(`AI plane rejected the request (${res.status})`, res.status);
    }
    const json = (await res.json()) as Record<string, unknown>;
    return {
      score: clampScore(json.score),
      issueCount: Number(json.issue_count ?? 0),
      issues: normaliseIssues(json.issues),
    };
  }
}

function clampScore(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, Math.round(n)));
}

function normaliseIssues(value: unknown): QualityIssue[] {
  if (!Array.isArray(value)) return [];
  return value.map((raw) => {
    const i = (raw ?? {}) as Record<string, unknown>;
    return {
      code: String(i.code ?? ''),
      message: String(i.message ?? ''),
      line: typeof i.line === 'number' ? i.line : null,
    };
  });
}
