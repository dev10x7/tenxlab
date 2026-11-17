import type {
  AttemptRepository,
  BatchRepository,
  EnrollmentRepository,
  InterviewAttemptRepository,
  LessonRepository,
  MembershipRepository,
  ProgressRepository,
  ProjectSubmissionRepository,
  SkillPassportRecord,
  SkillPassportRepository,
  TenantRepository,
  UserRepository,
} from '../common/ports';
import type { ContestService } from '../contests/contest.service';
import { demoAssessment } from '../assessments/demo-assessments';

/** The kinds of evidence that earn a badge. */
export type BadgeKind = 'lab' | 'assessment' | 'project' | 'interview';

/**
 * One verified badge on a passport. It carries a stable `id` (so the web list
 * keys on it), the `kind` (so the UI labels it), a human `label`, the score that
 * earned it, and when it was earned — the shape the web client renders (§2.8).
 */
export interface PassportBadge {
  id: string;
  kind: BadgeKind;
  label: string;
  score: number | null;
  earnedAt: string;
}

/** A student's own Skill Passport: the evidence behind their recruiter profile. */
export interface StudentPassportView {
  userId: string;
  fullName: string;
  email: string;
  verifiedBadges: number;
  avgLabScore: number | null;
  avgAssessmentScore: number | null;
  communicationScore: number | null;
  bestContestRank: number | null;
  badges: PassportBadge[];
  updatedAt: string;
}

/** One row in the recruiter's shortlist. */
export interface RecruiterRow {
  userId: string;
  fullName: string;
  email: string;
  institution: string;
  graduationYear: number | null;
  verifiedBadges: number;
  avgLabScore: number | null;
  communicationScore: number | null;
  bestContestRank: number | null;
  /** 0-100 readiness blend of lab and communication scores. */
  readiness: number | null;
}

/** Filters a recruiter may apply; every field is optional. */
export interface RecruiterFilters {
  /** Minimum average lab score (0-100). */
  minLabScore?: number;
  /** Minimum AI communication score (0-100). */
  minCommunicationScore?: number;
  /** Minimum verified badges. */
  minBadges?: number;
  /** Graduation year, matched exactly against the batch's end year. */
  graduationYear?: number;
  /** Case-insensitive substring match on the institution name. */
  institution?: string;
  /** Case-insensitive substring match on the student's name or email. */
  query?: string;
}

export interface PassportDeps {
  passports: SkillPassportRepository;
  progress: ProgressRepository;
  attempts: AttemptRepository;
  interviews: InterviewAttemptRepository;
  submissions: ProjectSubmissionRepository;
  lessons: LessonRepository;
  memberships: MembershipRepository;
  users: UserRepository;
  tenants: TenantRepository;
  batches: BatchRepository;
  enrollments: EnrollmentRepository;
  contests: ContestService;
}

/**
 * The Skill Passport (ByteXL parity §2.8): the indexed aggregate a recruiter
 * reads. It is derived, never authored — `refresh` recomputes it from the
 * primary tables (completed lessons, graded assessments, project submissions,
 * AI interview scores, and the best contest rank), then upserts the cache row.
 *
 * Badges are derived on read from real work, so a passport is never stale: the
 * index exists for the recruiter's *filter* (institution, graduation year, and
 * minimum scores), not to be authored directly.
 */
export class PassportService {
  constructor(private readonly deps: PassportDeps) {}

  /** Recompute one student's passport from the primary tables and persist it. */
  async refresh(userId: string, tenantId: string): Promise<SkillPassportRecord> {
    const [progress, attempts, interview, submissions, bestContestRank] = await Promise.all([
      this.deps.progress.listByUsers([userId]),
      this.deps.attempts.listByUser(userId),
      this.deps.interviews.latestByUser(userId),
      this.deps.submissions.listByUser(tenantId, userId),
      this.deps.contests.bestRank(userId),
    ]);

    const completed = progress.filter((p) => p.status === 'complete');
    const labScores = completed
      .map((p) => p.score)
      .filter((s): s is number => s != null);
    const avgLabScore = mean(labScores);

    const assessmentScores = attempts
      .filter((a) => a.status === 'submitted' && a.score != null)
      .map((a) => a.score as number);

    const verifiedBadges =
      completed.length +
      assessmentScores.length +
      submissions.filter((s) => s.status === 'evaluated').length +
      (interview ? 1 : 0);

    return this.deps.passports.upsert({
      userId,
      tenantId,
      verifiedBadges,
      avgLabScore,
      communicationScore: interview?.communicationScore ?? null,
      bestContestRank,
    });
  }

  /** The student's own passport, refreshed so it is never stale. */
  async forStudent(userId: string, tenantId: string): Promise<StudentPassportView> {
    const [record, user, badges, attempts] = await Promise.all([
      this.refresh(userId, tenantId),
      this.deps.users.findById(userId),
      this.badgesFor(userId, tenantId),
      this.deps.attempts.listByUser(userId),
    ]);

    const assessmentScores = attempts
      .filter((a) => a.status === 'submitted' && a.score != null)
      .map((a) => a.score as number);

    return {
      userId,
      fullName: user?.fullName ?? 'Student',
      email: user?.email ?? '',
      verifiedBadges: record.verifiedBadges,
      avgLabScore: record.avgLabScore ?? null,
      avgAssessmentScore: mean(assessmentScores),
      communicationScore: record.communicationScore ?? null,
      bestContestRank: record.bestContestRank ?? null,
      badges,
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  /** Every badge the student has earned, newest first. */
  async badgesFor(userId: string, tenantId: string): Promise<PassportBadge[]> {
    const [progress, attempts, interview, submissions] = await Promise.all([
      this.deps.progress.listByUsers([userId]),
      this.deps.attempts.listByUser(userId),
      this.deps.interviews.latestByUser(userId),
      this.deps.submissions.listByUser(tenantId, userId),
    ]);

    const badges: PassportBadge[] = [];

    const completed = progress.filter((p) => p.status === 'complete');
    const lessonIds = [...new Set(completed.map((p) => p.lessonId))];
    const lessons = await Promise.all(
      lessonIds.map((id) => this.deps.lessons.findById(id)),
    );
    const lessonTitles = new Map(
      lessonIds.map((id, i) => [id, lessons[i]?.title ?? id] as const),
    );

    for (const row of completed) {
      badges.push({
        id: `lab:${row.lessonId}`,
        kind: 'lab',
        label: lessonTitles.get(row.lessonId) ?? row.lessonId,
        score: row.score ?? null,
        earnedAt: (row.completedAt ?? new Date(0)).toISOString(),
      });
    }

    for (const attempt of attempts) {
      if (attempt.status !== 'submitted') continue;
      const assessment = demoAssessment(attempt.assessmentId);
      badges.push({
        id: `assessment:${attempt.id}`,
        kind: 'assessment',
        label: assessment?.title ?? attempt.assessmentId,
        score: attempt.score ?? null,
        earnedAt: (attempt.submittedAt ?? attempt.startedAt).toISOString(),
      });
    }

    for (const submission of submissions) {
      if (submission.status !== 'evaluated') continue;
      badges.push({
        id: `project:${submission.id}`,
        kind: 'project',
        label: submission.title,
        score: submission.score ?? null,
        earnedAt: (submission.evaluatedAt ?? submission.submittedAt).toISOString(),
      });
    }

    if (interview) {
      badges.push({
        id: `interview:${interview.id}`,
        kind: 'interview',
        label: interview.promptTitle,
        score: interview.communicationScore,
        earnedAt: interview.createdAt.toISOString(),
      });
    }

    return badges.sort((a, b) => b.earnedAt.localeCompare(a.earnedAt));
  }

  /**
   * The recruiter's shortlist: every student in the tenant with a refreshed
   * passport, filtered by institution, graduation year, minimum scores, and a
   * name/email query. Refreshing on read keeps the cache honest without a
   * background job.
   */
  async recruiter(
    tenantId: string,
    filters: RecruiterFilters = {},
  ): Promise<RecruiterRow[]> {
    const [memberships, tenant] = await Promise.all([
      this.deps.memberships.listByTenant(tenantId),
      this.deps.tenants.findById(tenantId),
    ]);
    const institution = tenant?.name ?? '';
    const studentIds = memberships
      .filter((m) => m.role === 'student')
      .map((m) => m.userId);

    const rows: RecruiterRow[] = [];
    for (const userId of studentIds) {
      const record = await this.refresh(userId, tenantId);
      const [user, graduationYear] = await Promise.all([
        this.deps.users.findById(userId),
        this.graduationYear(userId),
      ]);
      const row: RecruiterRow = {
        userId,
        fullName: user?.fullName ?? userId,
        email: user?.email ?? '',
        institution,
        graduationYear,
        verifiedBadges: record.verifiedBadges,
        avgLabScore: record.avgLabScore ?? null,
        communicationScore: record.communicationScore ?? null,
        bestContestRank: record.bestContestRank ?? null,
        readiness: readinessScore(
          record.avgLabScore ?? null,
          record.communicationScore ?? null,
        ),
      };
      if (matches(row, filters)) rows.push(row);
    }

    // Most job-ready first; unscored students sink to the bottom.
    return rows.sort((a, b) => (b.readiness ?? -1) - (a.readiness ?? -1));
  }

  /**
   * The shortlist as CSV, for a recruiter to take into their own pipeline. The
   * columns are the same the on-screen table shows, plus the raw scores.
   */
  async recruiterCsv(tenantId: string, filters: RecruiterFilters = {}): Promise<string> {
    const rows = await this.recruiter(tenantId, filters);
    return toRecruiterCsv(rows);
  }

  /** The year the student's batch is due to finish, or null when unknown. */
  private async graduationYear(userId: string): Promise<number | null> {
    const enrollments = await this.deps.enrollments.listByUser(userId);
    const years: number[] = [];
    for (const enrollment of enrollments) {
      if (!enrollment.batchId) continue;
      const batch = await this.deps.batches.findById(enrollment.batchId);
      if (batch?.endDate) years.push(batch.endDate.getUTCFullYear());
    }
    return years.length ? Math.max(...years) : null;
  }
}

/**
 * A 0-100 readiness blend of the lab and communication scores. Either score
 * alone yields that score; neither yields null (an unscored student is not a
 * zero — they are simply unranked).
 */
export function readinessScore(
  avgLabScore: number | null,
  communicationScore: number | null,
): number | null {
  if (avgLabScore == null && communicationScore == null) return null;
  if (avgLabScore == null) return communicationScore;
  if (communicationScore == null) return avgLabScore;
  return Math.round((avgLabScore + communicationScore) / 2);
}

/** The columns a recruiter's CSV export carries, in order. */
export const RECRUITER_CSV_COLUMNS = [
  'userId',
  'fullName',
  'email',
  'institution',
  'graduationYear',
  'verifiedBadges',
  'avgLabScore',
  'communicationScore',
  'bestContestRank',
  'readiness',
] as const;

/** Render the shortlist as RFC-4180 CSV (quoted fields, CRLF rows). */
export function toRecruiterCsv(rows: RecruiterRow[]): string {
  const header = RECRUITER_CSV_COLUMNS.join(',');
  const body = rows.map((row) =>
    [
      row.userId,
      row.fullName,
      row.email,
      row.institution,
      row.graduationYear ?? '',
      row.verifiedBadges,
      row.avgLabScore ?? '',
      row.communicationScore ?? '',
      row.bestContestRank ?? '',
      row.readiness ?? '',
    ]
      .map(csvField)
      .join(','),
  );
  return [header, ...body].join('\r\n') + '\r\n';
}

function csvField(value: string | number): string {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, n) => sum + n, 0) / values.length);
}

function matches(row: RecruiterRow, filters: RecruiterFilters): boolean {
  if (filters.minLabScore != null && (row.avgLabScore ?? 0) < filters.minLabScore) {
    return false;
  }
  if (
    filters.minCommunicationScore != null &&
    (row.communicationScore ?? 0) < filters.minCommunicationScore
  ) {
    return false;
  }
  if (filters.minBadges != null && row.verifiedBadges < filters.minBadges) {
    return false;
  }
  if (
    filters.graduationYear != null &&
    row.graduationYear !== filters.graduationYear
  ) {
    return false;
  }
  const institution = filters.institution?.trim().toLowerCase();
  if (institution && !row.institution.toLowerCase().includes(institution)) {
    return false;
  }
  const query = filters.query?.trim().toLowerCase();
  if (query) {
    const haystack = `${row.fullName} ${row.email}`.toLowerCase();
    if (!haystack.includes(query)) return false;
  }
  return true;
}
