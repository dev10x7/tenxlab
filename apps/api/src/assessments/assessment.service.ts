import { editorLanguage } from '@tenxlab/contracts';
import type { CodeExecutionProvider } from '@tenxlab/lab-provider';
import type {
  AttemptRecord,
  AttemptRepository,
  MembershipRepository,
} from '../common/ports';
import {
  gradeCoding,
  gradeDescriptive,
  gradeFill,
  gradeMcq,
  type CodeRunner,
  type CodingQuestion,
  type GradeResult,
} from './grader';
import {
  DEMO_ASSESSMENTS,
  demoAssessment,
  toQuestion,
  toQuestionView,
  type DemoAssessment,
  type DemoQuestion,
} from './demo-assessments';
import { checkSolutionRegion } from './read-only';
import {
  evaluateSubmission,
  remainingSeconds,
  startExamWindow,
  type Clock,
  systemClock,
} from './exam-timer';

/** Grace period that absorbs network latency on submit, never shown to a student. */
const SUBMIT_GRACE_SECONDS = 15;

export interface AssessmentQuestionDto {
  id: string;
  kind: DemoQuestion['kind'];
  prompt: string;
  maxScore: number;
  stubCode?: string;
  hasSolutionRegion: boolean;
  options?: string[];
  multiple?: boolean;
}

export interface AssessmentDto {
  id: string;
  courseSlug: string;
  title: string;
  mode: 'practice' | 'graded';
  proctored: boolean;
  durationSeconds: number | null;
  maxScore: number;
  questions: AssessmentQuestionDto[];
}

export interface AttemptDto {
  id: string;
  assessmentId: string;
  status: string;
  startedAt: string;
  endsAt: string | null;
  remainingSeconds: number | null;
  assessment: AssessmentDto;
}

export interface QuestionResultDto {
  questionId: string;
  score: number;
  maxScore: number;
  correct: boolean;
  feedback: string;
}

export interface AttemptResultDto {
  attemptId: string;
  status: string;
  score: number;
  maxScore: number;
  results: QuestionResultDto[];
}

export interface AssessmentDeps {
  attempts: AttemptRepository;
  /** Resolves an attempt's owner to a tenant, for instructor review scoping. */
  memberships?: MembershipRepository;
  /** Tier-1 pool for coding questions; null grades coding as unrunnable. */
  runner?: CodeExecutionProvider | null;
  assessments?: DemoAssessment[];
}

/**
 * The Assessment surface: list, start, and grade a sitting.
 *
 * The server owns the clock (see exam-timer): an attempt's deadline is stamped
 * at start and a late submission is rejected, so a tampered browser clock buys
 * nothing. Coding questions are graded by running the submission against hidden
 * test cases through the tier-1 pool; the read-only region of a stub is enforced
 * before the code runs, so a student cannot rewrite the harness.
 */
export class AssessmentService {
  private readonly assessments: DemoAssessment[];

  constructor(private readonly deps: AssessmentDeps) {
    this.assessments = deps.assessments ?? DEMO_ASSESSMENTS;
  }

  /** Assessments attached to a course, as the student sees them. */
  listByCourse(courseSlug: string): AssessmentDto[] {
    return this.assessments
      .filter((a) => a.courseSlug === courseSlug)
      .map((a) => toAssessmentDto(a));
  }

  listAll(): AssessmentDto[] {
    return this.assessments.map((a) => toAssessmentDto(a));
  }

  getAssessment(id: string): AssessmentDto | null {
    const a = this.find(id);
    return a ? toAssessmentDto(a) : null;
  }

  /**
   * Start a sitting, or resume the open one. Resuming rather than creating a
   * second attempt is what makes a page refresh safe: the deadline does not move.
   */
  async startAttempt(
    userId: string,
    assessmentId: string,
    clock: Clock = systemClock,
  ): Promise<AttemptDto | null> {
    const assessment = this.find(assessmentId);
    if (!assessment) return null;

    const open = await this.deps.attempts.findOpen(userId, assessmentId);
    if (open) return this.toAttemptDto(open, assessment, clock);

    const window =
      assessment.durationSeconds != null
        ? startExamWindow(assessmentId, assessment.durationSeconds, clock)
        : null;
    const record = await this.deps.attempts.create({
      userId,
      assessmentId,
      startedAt: clock.now(),
      endsAt: window?.endsAt ?? null,
    });
    return this.toAttemptDto(record, assessment, clock);
  }

  /** A live attempt, scoped to its owner. */
  async getAttempt(
    attemptId: string,
    userId: string,
    clock: Clock = systemClock,
  ): Promise<AttemptDto | null> {
    const record = await this.deps.attempts.findById(attemptId);
    if (!record || record.userId !== userId) return null;
    const assessment = this.find(record.assessmentId);
    if (!assessment) return null;
    return this.toAttemptDto(record, assessment, clock);
  }

  /** A student's attempts, newest first, with the assessment they belong to. */
  async history(userId: string): Promise<AttemptDto[]> {
    const records = await this.deps.attempts.listByUser(userId);
    const out: AttemptDto[] = [];
    for (const record of records) {
      const assessment = this.find(record.assessmentId);
      if (assessment) out.push(this.toAttemptDto(record, assessment));
    }
    return out;
  }

  /**
   * An attempt for instructor review, scoped to the reviewer's tenant. Returns
   * null when the attempt's owner is not a member of that tenant, so one college
   * can never read another's sittings.
   */
  async getAttemptForTenantReview(
    attemptId: string,
    tenantId: string,
  ): Promise<AttemptRecord | null> {
    const record = await this.deps.attempts.findById(attemptId);
    if (!record) return null;
    return (await this.ownerInTenant(record.userId, tenantId)) ? record : null;
  }

  /** Every attempt in a tenant, newest first, for the integrity view. */
  async reviewForTenant(tenantId: string): Promise<AttemptRecord[]> {
    const members = await this.deps.memberships?.listByTenant(tenantId);
    if (!members) return [];
    const userIds = new Set(members.map((m) => m.userId));
    const perUser = await Promise.all(
      [...userIds].map((userId) => this.deps.attempts.listByUser(userId)),
    );
    return perUser.flat().sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  }

  private async ownerInTenant(userId: string, tenantId: string): Promise<boolean> {
    const membership = await this.deps.memberships?.find(userId, tenantId);
    return Boolean(membership);
  }

  /**
   * Grade and close an attempt. A submission past the deadline (plus grace) is
   * still recorded but marked `expired` and scored zero, so the instructor sees
   * that an attempt was made rather than losing it.
   */
  async submit(
    attemptId: string,
    userId: string,
    answers: Record<string, unknown>,
    clock: Clock = systemClock,
  ): Promise<AttemptResultDto | { reason: 'not_found' | 'already_submitted' | 'expired' }> {
    const record = await this.deps.attempts.findById(attemptId);
    if (!record || record.userId !== userId) return { reason: 'not_found' };
    if (record.status !== 'in_progress') return { reason: 'already_submitted' };

    const assessment = this.find(record.assessmentId);
    if (!assessment) return { reason: 'not_found' };

    const window =
      record.endsAt != null
        ? {
            attemptId: record.id,
            startedAt: record.startedAt,
            durationSeconds: assessment.durationSeconds ?? 0,
            endsAt: record.endsAt,
          }
        : null;
    const decision = window
      ? evaluateSubmission(window, clock, SUBMIT_GRACE_SECONDS)
      : { accepted: true as const, remainingSeconds: 0 };

    const { results, total, maxTotal } = await this.grade(assessment, answers);
    const expired = !decision.accepted;
    const score = expired ? 0 : total;

    await this.deps.attempts.update(attemptId, {
      status: expired ? 'expired' : 'submitted',
      submittedAt: clock.now(),
      score,
      answers: JSON.stringify(answers),
      results: JSON.stringify(results),
    });

    return {
      attemptId,
      status: expired ? 'expired' : 'submitted',
      score,
      maxScore: maxTotal,
      results,
    };
  }

  /** Grade every question, enforcing the read-only region on coding stubs. */
  private async grade(
    assessment: DemoAssessment,
    answers: Record<string, unknown>,
  ): Promise<{ results: QuestionResultDto[]; total: number; maxTotal: number }> {
    const results: QuestionResultDto[] = [];
    let total = 0;
    let maxTotal = 0;

    for (const q of assessment.questions) {
      const answer = answers[q.id];
      const question = toQuestion(q);
      let result: GradeResult;

      switch (question.type) {
        case 'coding':
          result = await this.gradeCodingQuestion(q, question, String(answer ?? ''));
          break;
        case 'mcq':
          result = gradeMcq(question, answer);
          break;
        case 'fill':
          result = gradeFill(question, answer);
          break;
        case 'descriptive':
          result = gradeDescriptive(question, answer);
          break;
      }

      results.push({
        questionId: q.id,
        score: result.score,
        maxScore: result.maxScore,
        correct: result.correct,
        feedback: result.feedback,
      });
      total += result.score;
      maxTotal += result.maxScore;
    }

    return { results, total, maxTotal };
  }

  private async gradeCodingQuestion(
    q: DemoQuestion,
    question: CodingQuestion,
    submitted: string,
  ): Promise<GradeResult> {
    // Enforce the read-only region before running anything: a rewritten harness
    // is not the student's code and must not be graded as if it were.
    if (q.stubCode && toQuestionView(q).hasSolutionRegion) {
      const violation = checkSolutionRegion(q.id, q.stubCode, submitted);
      if (violation) {
        return {
          score: 0,
          maxScore: question.maxScore,
          correct: false,
          feedback: `Read-only region modified (${violation.reason}).`,
        };
      }
    }

    const runner = this.runnerFor(q.language);
    if (!runner) {
      return {
        score: 0,
        maxScore: question.maxScore,
        correct: false,
        feedback: 'Code execution is unavailable; this question could not be graded.',
      };
    }
    return gradeCoding(question, submitted, runner);
  }

  /** A CodeRunner bound to one language, backed by the tier-1 pool. */
  private runnerFor(language: string | undefined): CodeRunner | null {
    const provider = this.deps.runner;
    if (!provider) return null;
    const lang = editorLanguage(language ?? 'python');
    if (!lang) return null;
    return {
      run: async (code, input) => {
        const result = await provider.run({
          runtime: lang.pistonRuntime,
          source: code,
          stdin: input,
        });
        return result.stdout;
      },
    };
  }

  private find(id: string): DemoAssessment | undefined {
    return this.assessments.find((a) => a.id === id) ?? demoAssessment(id);
  }

  private toAttemptDto(
    record: AttemptRecord,
    assessment: DemoAssessment,
    clock: Clock = systemClock,
  ): AttemptDto {
    const window =
      record.endsAt != null
        ? {
            attemptId: record.id,
            startedAt: record.startedAt,
            durationSeconds: assessment.durationSeconds ?? 0,
            endsAt: record.endsAt,
          }
        : null;
    return {
      id: record.id,
      assessmentId: record.assessmentId,
      status: record.status,
      startedAt: record.startedAt.toISOString(),
      endsAt: record.endsAt ? record.endsAt.toISOString() : null,
      remainingSeconds: window ? remainingSeconds(window, clock) : null,
      assessment: toAssessmentDto(assessment),
    };
  }
}

function toAssessmentDto(a: DemoAssessment): AssessmentDto {
  const questions = a.questions.map((q) => toQuestionView(q));
  return {
    id: a.id,
    courseSlug: a.courseSlug,
    title: a.title,
    mode: a.mode,
    proctored: a.mode === 'graded',
    durationSeconds: a.durationSeconds,
    maxScore: questions.reduce((sum, q) => sum + q.maxScore, 0),
    questions,
  };
}
