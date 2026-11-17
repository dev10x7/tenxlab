import type {
  InterviewAttemptRepository,
  MembershipRepository,
  ProgressRepository,
  SkillPassportRecord,
  SkillPassportRepository,
  UserRepository,
} from '../common/ports';

/** One verified badge on a passport: a lesson the student has completed. */
export interface PassportBadge {
  lessonId: string;
  score: number | null;
  completedAt: string | null;
}

/** A student's own Skill Passport: the evidence behind their recruiter profile. */
export interface StudentPassportView {
  userId: string;
  fullName: string;
  verifiedBadges: number;
  avgLabScore: number | null;
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
  /** Case-insensitive substring match on the student's name or email. */
  query?: string;
}

export interface PassportDeps {
  passports: SkillPassportRepository;
  progress: ProgressRepository;
  interviews: InterviewAttemptRepository;
  memberships: MembershipRepository;
  users: UserRepository;
}

/**
 * The Skill Passport (ByteXL parity §2.8): the indexed aggregate a recruiter
 * reads. It is derived, never authored — `refresh` recomputes it from the
 * primary tables (completed lessons, AI interview scores, and — once contests
 * ship in Phase G — the best contest rank), then upserts the cache row.
 *
 * `bestContestRank` is always null until contests exist; the column is carried
 * so the recruiter filter does not need a migration when they land.
 */
export class PassportService {
  constructor(private readonly deps: PassportDeps) {}

  /** Recompute one student's passport from the primary tables and persist it. */
  async refresh(userId: string, tenantId: string): Promise<SkillPassportRecord> {
    const [progress, interview] = await Promise.all([
      this.deps.progress.listByUsers([userId]),
      this.deps.interviews.latestByUser(userId),
    ]);

    const completed = progress.filter((p) => p.status === 'complete');
    const scores = completed
      .map((p) => p.score)
      .filter((s): s is number => s != null);
    const avgLabScore = scores.length
      ? Math.round(scores.reduce((sum, n) => sum + n, 0) / scores.length)
      : null;

    return this.deps.passports.upsert({
      userId,
      tenantId,
      verifiedBadges: completed.length,
      avgLabScore,
      communicationScore: interview?.communicationScore ?? null,
      // Contests arrive in Phase G; the aggregate carries the column now.
      bestContestRank: null,
    });
  }

  /** The student's own passport, refreshed so it is never stale. */
  async forStudent(userId: string, tenantId: string): Promise<StudentPassportView> {
    const [record, user, progress] = await Promise.all([
      this.refresh(userId, tenantId),
      this.deps.users.findById(userId),
      this.deps.progress.listByUsers([userId]),
    ]);

    const badges: PassportBadge[] = progress
      .filter((p) => p.status === 'complete')
      .map((p) => ({
        lessonId: p.lessonId,
        score: p.score ?? null,
        completedAt: p.completedAt ? p.completedAt.toISOString() : null,
      }));

    return {
      userId,
      fullName: user?.fullName ?? 'Student',
      verifiedBadges: record.verifiedBadges,
      avgLabScore: record.avgLabScore ?? null,
      communicationScore: record.communicationScore ?? null,
      bestContestRank: record.bestContestRank ?? null,
      badges,
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  /**
   * The recruiter's shortlist: every student in the tenant with a refreshed
   * passport, filtered by minimum scores and a name/email query. Refreshing on
   * read keeps the cache honest without a background job.
   */
  async recruiter(
    tenantId: string,
    filters: RecruiterFilters = {},
  ): Promise<RecruiterRow[]> {
    const memberships = await this.deps.memberships.listByTenant(tenantId);
    const studentIds = memberships
      .filter((m) => m.role === 'student')
      .map((m) => m.userId);

    const rows: RecruiterRow[] = [];
    for (const userId of studentIds) {
      const record = await this.refresh(userId, tenantId);
      const user = await this.deps.users.findById(userId);
      const row: RecruiterRow = {
        userId,
        fullName: user?.fullName ?? userId,
        email: user?.email ?? '',
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
  const query = filters.query?.trim().toLowerCase();
  if (query) {
    const haystack = `${row.fullName} ${row.email}`.toLowerCase();
    if (!haystack.includes(query)) return false;
  }
  return true;
}
