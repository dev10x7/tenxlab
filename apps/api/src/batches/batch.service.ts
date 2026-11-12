import type {
  BatchRepository,
  EnrollmentRepository,
  MembershipRepository,
  ProgressRepository,
  UserRepository,
} from '../common/ports';

export interface BatchSummaryDto {
  id: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
  studentCount: number;
}

export interface RosterEntryDto {
  userId: string;
  fullName: string;
  email: string;
}

export interface GradebookCellDto {
  lessonId: string;
  title: string;
  status: string;
  score: number | null;
}

export interface GradebookRowDto {
  userId: string;
  fullName: string;
  email: string;
  completed: number;
  total: number;
  averageScore: number | null;
  cells: GradebookCellDto[];
}

export interface GradebookDto {
  batchId: string;
  batchName: string;
  lessons: Array<{ id: string; title: string }>;
  rows: GradebookRowDto[];
}

/**
 * Cohort management: create batches, assign students, and read the instructor
 * gradebook. The gradebook aggregates each enrolled student's progress rows
 * against the batch's lessons, so a score that lands from the lab webhook shows
 * up here without a second write path.
 *
 * Reads are pure over the injected ports, so the DTO shapes are unit-testable
 * without a database.
 */
export class BatchService {
  constructor(
    private readonly batches: BatchRepository,
    private readonly enrollments: EnrollmentRepository,
    private readonly memberships: MembershipRepository,
    private readonly users: UserRepository,
    private readonly progress: ProgressRepository,
    /** Lesson ids in the batch's course, in display order. */
    private readonly courseLessons: Array<{ id: string; title: string }> = [],
  ) {}

  async listBatches(tenantId: string): Promise<BatchSummaryDto[]> {
    const batches = await this.batches.listByTenant(tenantId);
    const out: BatchSummaryDto[] = [];
    for (const b of batches) {
      const roster = await this.enrollments.listByBatch(b.id);
      out.push({
        id: b.id,
        name: b.name,
        startDate: b.startDate ? b.startDate.toISOString() : null,
        endDate: b.endDate ? b.endDate.toISOString() : null,
        studentCount: new Set(roster.map((e) => e.userId)).size,
      });
    }
    // Populated cohorts first, so the gradebook's default selection is one with
    // students in it rather than an empty batch.
    return out.sort((a, b) => b.studentCount - a.studentCount || a.name.localeCompare(b.name));
  }

  async createBatch(input: {
    tenantId: string;
    name: string;
    startDate?: string | null;
    endDate?: string | null;
  }): Promise<BatchSummaryDto> {
    const b = await this.batches.create({
      tenantId: input.tenantId,
      name: input.name,
      startDate: input.startDate ? new Date(input.startDate) : null,
      endDate: input.endDate ? new Date(input.endDate) : null,
    });
    return {
      id: b.id,
      name: b.name,
      startDate: b.startDate ? b.startDate.toISOString() : null,
      endDate: b.endDate ? b.endDate.toISOString() : null,
      studentCount: 0,
    };
  }

  /** Students of the tenant, so the instructor can pick who to assign. */
  async listStudents(tenantId: string): Promise<RosterEntryDto[]> {
    const memberships = await this.memberships.listByTenant(tenantId);
    const students = memberships.filter((m) => m.role === 'student');
    const out: RosterEntryDto[] = [];
    for (const m of students) {
      const user = await this.users.findById(m.userId);
      if (user) out.push({ userId: user.id, fullName: user.fullName, email: user.email });
    }
    return out;
  }

  async roster(batchId: string, tenantId: string): Promise<RosterEntryDto[] | null> {
    const batch = await this.batches.findById(batchId);
    if (!batch || batch.tenantId !== tenantId) return null;
    const enrollments = await this.enrollments.listByBatch(batchId);
    const out: RosterEntryDto[] = [];
    for (const userId of new Set(enrollments.map((e) => e.userId))) {
      const user = await this.users.findById(userId);
      if (user) out.push({ userId: user.id, fullName: user.fullName, email: user.email });
    }
    return out;
  }

  /**
   * Assign a student to the batch's course. Idempotent, and rejects a user who
   * is not a student of the tenant so a roster cannot be polluted by a stray id.
   */
  async assign(input: {
    batchId: string;
    userId: string;
    courseId: string;
    tenantId: string;
  }): Promise<{ ok: true } | { ok: false; reason: 'batch_not_found' | 'not_a_student' }> {
    const batch = await this.batches.findById(input.batchId);
    if (!batch || batch.tenantId !== input.tenantId) {
      return { ok: false, reason: 'batch_not_found' };
    }
    const membership = await this.memberships.find(input.userId, input.tenantId);
    if (!membership || membership.role !== 'student') {
      return { ok: false, reason: 'not_a_student' };
    }
    await this.enrollments.assign({
      userId: input.userId,
      courseId: input.courseId,
      batchId: input.batchId,
    });
    return { ok: true };
  }

  async gradebook(batchId: string, tenantId: string): Promise<GradebookDto | null> {
    const batch = await this.batches.findById(batchId);
    if (!batch || batch.tenantId !== tenantId) return null;

    const enrollments = await this.enrollments.listByBatch(batchId);
    const userIds = [...new Set(enrollments.map((e) => e.userId))];
    const progressRows = await this.progress.listByUsers(userIds);

    const rows: GradebookRowDto[] = [];
    for (const userId of userIds) {
      const user = await this.users.findById(userId);
      if (!user) continue;
      const byLesson = new Map(
        progressRows.filter((p) => p.userId === userId).map((p) => [p.lessonId, p]),
      );
      const cells: GradebookCellDto[] = this.courseLessons.map((lesson) => {
        const record = byLesson.get(lesson.id);
        return {
          lessonId: lesson.id,
          title: lesson.title,
          status: record?.status ?? 'not_started',
          score: record?.score ?? null,
        };
      });
      const graded = cells.filter((c) => c.score != null);
      rows.push({
        userId: user.id,
        fullName: user.fullName,
        email: user.email,
        completed: cells.filter((c) => c.status === 'complete').length,
        total: cells.length,
        averageScore:
          graded.length === 0
            ? null
            : Math.round(
                graded.reduce((sum, c) => sum + (c.score ?? 0), 0) / graded.length,
              ),
        cells,
      });
    }

    return {
      batchId: batch.id,
      batchName: batch.name,
      lessons: this.courseLessons,
      rows,
    };
  }
}
