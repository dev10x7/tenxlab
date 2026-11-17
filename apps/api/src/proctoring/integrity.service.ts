/**
 * Anti-cheat: batch-scope code-similarity scanning (ByteXL parity §4.2).
 *
 * Browser proctoring (see `proctoring.service.ts`) catches what happens *in the
 * browser*; this catches what is *in the submission*. For one graded assessment
 * we gather every student's coding answers, hand the cohort to the AI plane's
 * rename-invariant plagiarism scorer (winnowing fingerprints, `plagiarism.py`),
 * and surface the matches for an instructor to review.
 *
 * Like proctoring, this is advisory: it reports candidate matches with a
 * similarity score, never an automatic verdict. The scan is instructor-triggered
 * (one call per assessment) rather than run on every read, because it is
 * O(n²) in the cohort and belongs behind a deliberate action.
 */

import type { MembershipRepository, UserRepository } from '../common/ports';
import type {
  PlagiarismReport,
  PlagiarismScanner,
} from '../ai/ai-bridge.client';
import type { AssessmentService } from '../assessments/assessment.service';

/** One student's worst match in the scan, with their name resolved. */
export interface IntegrityMatch {
  userId: string;
  studentName: string;
  similarity: number;
}

/** One student's integrity result across every coding question in the test. */
export interface IntegrityResult {
  userId: string;
  studentName: string;
  /** Highest similarity against any peer, across all coding questions. */
  maxSimilarity: number;
  flagged: boolean;
  /** Peers this student resembles, best first. */
  matches: IntegrityMatch[];
}

export interface IntegrityScan {
  assessmentId: string;
  /** Number of students whose coding answers were compared. */
  compared: number;
  /** The similarity ratio at or above which a student is flagged. */
  threshold: number;
  flaggedCount: number;
  results: IntegrityResult[];
}

export interface IntegrityDeps {
  assessments: AssessmentService;
  memberships: MembershipRepository;
  users: UserRepository;
  /** Null when the AI plane is not configured; the scan then reports unavailable. */
  scanner: PlagiarismScanner | null;
}

/** Default flag threshold: matches ByteXL's > 85% similarity flag (§4.2). */
export const DEFAULT_SIMILARITY_THRESHOLD = 0.85;

export class IntegrityService {
  constructor(private readonly deps: IntegrityDeps) {}

  /** True when a scan can run at all (the AI plane must be configured). */
  get available(): boolean {
    return this.deps.scanner != null;
  }

  /**
   * Scan one assessment's coding answers for similarity. Returns an empty,
   * unflagged scan when the assessment has no graded attempts yet, so the caller
   * does not have to special-case an empty cohort.
   */
  async scanAssessment(
    assessmentId: string,
    tenantId: string,
    threshold: number = DEFAULT_SIMILARITY_THRESHOLD,
  ): Promise<IntegrityScan> {
    const assessment = this.deps.assessments.getAssessment(assessmentId);
    const codingQuestionIds = (assessment?.questions ?? [])
      .filter((q) => q.kind === 'coding')
      .map((q) => q.id);

    const attempts = (
      await this.deps.assessments.reviewForTenant(tenantId)
    ).filter(
      (a) => a.assessmentId === assessmentId && a.answers != null,
    );

    const empty: IntegrityScan = {
      assessmentId,
      compared: 0,
      threshold,
      flaggedCount: 0,
      results: [],
    };
    if (!this.deps.scanner || codingQuestionIds.length === 0 || attempts.length < 2) {
      return empty;
    }

    // Per student, keep the worst (highest-similarity) report across questions.
    const worstByUser = new Map<string, PlagiarismReport>();
    for (const questionId of codingQuestionIds) {
      const cohort = attempts
        .map((a) => ({
          studentId: a.userId,
          code: codeAnswer(a.answers, questionId),
        }))
        .filter((s) => s.code.trim().length > 0);
      if (cohort.length < 2) continue;

      const reports = await this.deps.scanner.compareSubmissions({
        tenantId,
        exerciseId: `${assessmentId}:${questionId}`,
        submissions: cohort,
        threshold,
      });
      for (const report of reports) {
        const current = worstByUser.get(report.studentId);
        if (!current || report.maxSimilarity > current.maxSimilarity) {
          worstByUser.set(report.studentId, report);
        }
      }
    }

    const names = await this.resolveNames([...worstByUser.keys()]);
    const results: IntegrityResult[] = [...worstByUser.entries()]
      .map(([userId, report]) => ({
        userId,
        studentName: names.get(userId) ?? userId,
        maxSimilarity: report.maxSimilarity,
        flagged: report.maxSimilarity >= threshold,
        matches: report.matches.map((m) => ({
          userId: m.studentId,
          studentName: names.get(m.studentId) ?? m.studentId,
          similarity: m.similarity,
        })),
      }))
      .sort((a, b) => b.maxSimilarity - a.maxSimilarity);

    return {
      assessmentId,
      compared: worstByUser.size,
      threshold,
      flaggedCount: results.filter((r) => r.flagged).length,
      results,
    };
  }

  private async resolveNames(userIds: string[]): Promise<Map<string, string>> {
    const users = await Promise.all(
      userIds.map((id) => this.deps.users.findById(id)),
    );
    const map = new Map<string, string>();
    for (const user of users) {
      if (user) map.set(user.id, user.fullName);
    }
    return map;
  }
}

/** Pull one coding answer out of the stored answer blob, tolerating bad JSON. */
function codeAnswer(answers: string | null, questionId: string): string {
  if (!answers) return '';
  try {
    const parsed = JSON.parse(answers) as Record<string, unknown>;
    const value = parsed[questionId];
    return typeof value === 'string' ? value : '';
  } catch {
    return '';
  }
}
