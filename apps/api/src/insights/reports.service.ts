import type {
  AttendanceRepository,
  BatchRepository,
  ClassSessionRepository,
  EnrollmentRepository,
  ProgressRepository,
  ProjectRepository,
  ProjectSubmissionRepository,
  UserRepository,
} from '../common/ports';
import type { CourseCatalog } from '../catalog/course-catalog';

/** A cohort-wide roll-up for one batch, for the instructor's reports surface. */
export interface BatchReport {
  batchId: string;
  batchName: string;
  studentCount: number;
  /** Mean lesson-completion percent across the roster, 0-100. */
  avgCompletion: number;
  /** Mean graded score across the roster, or null when nothing is graded. */
  avgScore: number | null;
  /** Attendance percent across the batch's sessions, or null when none exist. */
  attendancePercent: number | null;
  /** Project submissions awaiting a trainer score. */
  pendingSubmissions: number;
}

/** One student row inside a batch report. */
export interface BatchReportRow {
  userId: string;
  fullName: string;
  email: string;
  lessonsComplete: number;
  lessonsTotal: number;
  completion: number;
  averageScore: number | null;
  attendancePercent: number | null;
}

export interface BatchReportDetail {
  report: BatchReport;
  rows: BatchReportRow[];
}

export interface ReportDeps {
  batches: BatchRepository;
  enrollments: EnrollmentRepository;
  progress: ProgressRepository;
  users: UserRepository;
  classSessions: ClassSessionRepository;
  attendance: AttendanceRepository;
  projects: ProjectRepository;
  submissions: ProjectSubmissionRepository;
  /** Resolves a batch's courses to their lessons, in display order. */
  courses: CourseCatalog;
}

/**
 * The instructor's Student Reports surface (ByteXL parity §2.10). It rolls the
 * same rows the gradebook and attendance boards read into cohort-level numbers,
 * so a trainer can read a batch at a glance without opening each student. Every
 * figure is computed from the repositories — there is no separate analytics
 * store to drift out of sync.
 */
export class ReportsService {
  constructor(private readonly deps: ReportDeps) {}

  /** Every batch in the tenant, each with its cohort roll-up. */
  async forTenant(tenantId: string): Promise<BatchReport[]> {
    const batches = await this.deps.batches.listByTenant(tenantId);
    const reports: BatchReport[] = [];
    for (const batch of batches) {
      reports.push(await this.build(tenantId, batch.id, batch.name));
    }
    return reports;
  }

  /** One batch's roll-up plus its per-student rows. */
  async forBatch(tenantId: string, batchId: string): Promise<BatchReportDetail | null> {
    const batch = await this.deps.batches.findById(batchId);
    if (!batch || batch.tenantId !== tenantId) return null;
    const report = await this.build(tenantId, batch.id, batch.name);
    const rows = await this.rows(batch.id);
    return { report, rows };
  }

  private async build(
    tenantId: string,
    batchId: string,
    batchName: string,
  ): Promise<BatchReport> {
    const rows = await this.rows(batchId);
    return {
      batchId,
      batchName,
      studentCount: rows.length,
      avgCompletion: mean(rows.map((r) => r.completion)) ?? 0,
      avgScore: mean(
        rows.map((r) => r.averageScore).filter((s): s is number => s != null),
      ),
      attendancePercent: mean(
        rows.map((r) => r.attendancePercent).filter((a): a is number => a != null),
      ),
      pendingSubmissions: await this.pendingSubmissions(tenantId),
    };
  }

  /** Per-student roll-up rows for a batch, from enrolment → progress → score. */
  private async rows(batchId: string): Promise<BatchReportRow[]> {
    const roster = await this.deps.enrollments.listByBatch(batchId);
    const userIds = [...new Set(roster.map((e) => e.userId))];
    const progressRows = await this.deps.progress.listByUsers(userIds);
    const lessonIds = await this.lessonIdsFor(roster);
    const attendance = await this.attendanceByUser(batchId);

    const rows: BatchReportRow[] = [];
    for (const userId of userIds) {
      const user = await this.deps.users.findById(userId);
      if (!user) continue;
      const mine = progressRows.filter(
        (p) => p.userId === userId && lessonIds.has(p.lessonId),
      );
      const complete = mine.filter((p) => p.status === 'complete').length;
      const scores = mine
        .map((p) => p.score)
        .filter((s): s is number => s != null);

      rows.push({
        userId,
        fullName: user.fullName,
        email: user.email,
        lessonsComplete: complete,
        lessonsTotal: lessonIds.size,
        completion: lessonIds.size ? Math.round((complete / lessonIds.size) * 100) : 0,
        averageScore: scores.length ? Math.round(mean(scores)!) : null,
        attendancePercent: attendance.get(userId) ?? null,
      });
    }
    return rows;
  }

  /** The distinct lesson ids of a batch's enrolled courses. */
  private async lessonIdsFor(
    enrollments: Array<{ courseId: string }>,
  ): Promise<Set<string>> {
    const ids = new Set<string>();
    const seenCourse = new Set<string>();
    for (const enrolment of enrollments) {
      if (seenCourse.has(enrolment.courseId)) continue;
      seenCourse.add(enrolment.courseId);
      const course = await this.deps.courses.resolve(enrolment.courseId);
      for (const lesson of course?.lessons ?? []) ids.add(lesson.id);
    }
    return ids;
  }

  /** Each student's attendance percent across the batch's sessions. */
  private async attendanceByUser(batchId: string): Promise<Map<string, number>> {
    const sessions = await this.deps.classSessions.listByBatch(batchId);
    const out = new Map<string, number>();
    if (sessions.length === 0) return out;
    const rows = await this.deps.attendance.listBySessions(sessions.map((s) => s.id));
    const byUser = new Map<string, { attended: number; counted: number }>();
    for (const row of rows) {
      if (row.status === 'excused') continue;
      const tally = byUser.get(row.userId) ?? { attended: 0, counted: 0 };
      tally.counted += 1;
      if (row.status === 'present' || row.status === 'late') tally.attended += 1;
      byUser.set(row.userId, tally);
    }
    for (const [userId, tally] of byUser) {
      if (tally.counted > 0) {
        out.set(userId, Math.round((tally.attended / tally.counted) * 100));
      }
    }
    return out;
  }

  /** How many project submissions in the tenant still await a trainer score. */
  private async pendingSubmissions(tenantId: string): Promise<number> {
    const projects = await this.deps.projects.listByTenant(tenantId);
    let pending = 0;
    for (const project of projects) {
      const submissions = await this.deps.submissions.listByProject(tenantId, project.id);
      pending += submissions.filter((s) => s.evaluatedAt == null).length;
    }
    return pending;
  }
}

/** Mean of a list of numbers, or null when the list is empty. */
function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((sum, n) => sum + n, 0) / values.length);
}
