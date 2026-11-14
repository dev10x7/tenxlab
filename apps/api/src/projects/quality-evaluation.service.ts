import type { WorkspaceReader } from '@tenxlab/lab-provider';
import type {
  ProjectWorkspaceRecord,
  ProjectWorkspaceRepository,
  QualityEvaluationRecord,
  QualityEvaluationRepository,
} from '../common/ports';
import type { QualityAnalyzer, QualityReport } from '../ai/ai-bridge.client';

export interface QualityEvaluationDeps {
  workspaces: ProjectWorkspaceRepository;
  evaluations: QualityEvaluationRepository;
  /** Reads the workspace's source files; null disables analysis. */
  reader?: WorkspaceReader | null;
  /** The AI plane; null disables analysis. */
  analyzer?: QualityAnalyzer | null;
}

export type AnalyzeOutcome =
  | { ok: true; evaluation: QualityEvaluationRecord; report: QualityReport | null }
  | { ok: false; reason: AnalyzeFailureReason; message: string };

export type AnalyzeFailureReason =
  | 'workspace_not_found'
  | 'workspace_not_running'
  | 'analysis_unavailable'
  | 'analysis_failed';

/** Source/config extensions the quality analyzer understands. */
export const DEFAULT_EXTENSIONS = [
  'py', 'js', 'jsx', 'ts', 'tsx', 'java', 'go', 'rb', 'rs', 'c', 'h',
  'cpp', 'cs', 'kt', 'php', 'sql', 'sh', 'yaml', 'yml', 'json', 'html',
  'css', 'md',
];

/**
 * Nimbus auto-evaluation (Phase E, the SonarQube-equivalent run, ADR-13).
 *
 * On demand — from the student's workspace or at submit — the service reads the
 * workspace's source files through the lab provider and scores them with the AI
 * plane's explainable quality analyzer. The result is stored on the workspace
 * (latest) and appended to an evaluation history, so a trainer can always see
 * what the analyser said and when.
 */
export class QualityEvaluationService {
  constructor(private readonly deps: QualityEvaluationDeps) {}

  /** Run an auto-evaluation against the caller's workspace. */
  async analyze(
    userId: string,
    workspaceId: string,
    context: { projectId?: string | null; componentId?: string | null } = {},
  ): Promise<AnalyzeOutcome> {
    const workspace = await this.deps.workspaces.findById(workspaceId);
    if (!workspace || workspace.userId !== userId) {
      return { ok: false, reason: 'workspace_not_found', message: 'Workspace not found' };
    }
    if (workspace.status !== 'running') {
      return {
        ok: false,
        reason: 'workspace_not_running',
        message: `Workspace must be running to analyse (status: ${workspace.status})`,
      };
    }
    if (!this.deps.reader || !this.deps.analyzer) {
      return {
        ok: false,
        reason: 'analysis_unavailable',
        message: 'Auto-evaluation is not configured on this deployment',
      };
    }

    let report: QualityReport;
    try {
      const files = await this.deps.reader.readWorkspaceFiles({
        sessionId: workspace.id,
        extensions: DEFAULT_EXTENSIONS,
      });
      const code = files
        .map((f) => `# ==== ${f.path} ====\n${f.content}`)
        .join('\n\n');
      report = await this.deps.analyzer.scoreQuality({
        tenantId: workspace.tenantId,
        projectId: context.projectId ?? workspace.templateSlug,
        studentId: workspace.userId,
        code,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'auto-evaluation failed';
      const evaluation = await this.deps.evaluations.create({
        tenantId: workspace.tenantId,
        userId: workspace.userId,
        projectId: context.projectId ?? null,
        componentId: context.componentId ?? null,
        workspaceId: workspace.id,
        score: null,
        issueCount: 0,
        report: null,
        status: 'failed',
        error: message,
      });
      return { ok: false, reason: 'analysis_failed', message };
    }

    const encoded = JSON.stringify(report);
    const now = new Date();
    const evaluation = await this.deps.evaluations.create({
      tenantId: workspace.tenantId,
      userId: workspace.userId,
      projectId: context.projectId ?? null,
      componentId: context.componentId ?? null,
      workspaceId: workspace.id,
      score: report.score,
      issueCount: report.issueCount,
      report: encoded,
      status: 'succeeded',
      error: null,
    });
    await this.deps.workspaces.update(workspace.id, {
      qualityScore: report.score,
      qualityReport: encoded,
      analyzedAt: now,
    });
    return { ok: true, evaluation, report };
  }

  /** The latest auto-evaluation of the caller's workspace, if any. */
  async latest(
    userId: string,
    workspaceId: string,
  ): Promise<QualityEvaluationRecord | null> {
    const workspace = await this.deps.workspaces.findById(workspaceId);
    if (!workspace || workspace.userId !== userId) return null;
    return this.deps.evaluations.latestByWorkspace(workspaceId);
  }

  /**
   * The caller's auto-evaluation history for a workspace, newest first. Throws
   * `workspace_not_found` (as a 404 at the HTTP edge) when the workspace is
   * missing or owned by someone else, so history is never readable cross-tenant.
   */
  async history(
    userId: string,
    workspaceId: string,
  ): Promise<QualityEvaluationRecord[]> {
    const workspace = await this.deps.workspaces.findById(workspaceId);
    if (!workspace || workspace.userId !== userId) {
      throw new WorkspaceNotFoundError(workspaceId);
    }
    return this.deps.evaluations.listByWorkspace(workspaceId);
  }
}

/** Raised when a workspace is missing or not owned by the caller. */
export class WorkspaceNotFoundError extends Error {
  constructor(readonly workspaceId: string) {
    super('Workspace not found');
    this.name = 'WorkspaceNotFoundError';
  }
}

/** Parse a stored JSON quality report, tolerating a null/garbled value. */
export function parseReport(encoded: string | null): QualityReport | null {
  if (!encoded) return null;
  try {
    return JSON.parse(encoded) as QualityReport;
  } catch {
    return null;
  }
}

/** The workspace fields the submission copies into its auto-evaluation columns. */
export function autoFieldsFrom(workspace: ProjectWorkspaceRecord): {
  autoScore: number | null;
  autoReport: string | null;
  autoEvaluatedAt: Date | null;
} {
  return {
    autoScore: workspace.qualityScore,
    autoReport: workspace.qualityReport,
    autoEvaluatedAt: workspace.analyzedAt,
  };
}
