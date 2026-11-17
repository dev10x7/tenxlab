import { PrismaClient } from '@prisma/client';
import type {
  AttendanceRecord,
  AttendanceRepository,
  AttemptRecord,
  AttemptRepository,
  BatchRecord,
  BatchRepository,
  ClassSessionRecord,
  ClassSessionRepository,
  ContestEntryRecord,
  ContestEntryRepository,
  ContestRecord,
  ContestRepository,
  CourseRecord,
  CourseRepository,
  EnrollmentRecord,
  EnrollmentRepository,
  EventLedger,
  GitConnectionRecord,
  GitConnectionRepository,
  GitPublishRecord,
  GitPublishRepository,
  LabSessionRecord,
  LabSessionRepository,
  LessonProgressRecord,
  LessonRecord,
  LessonRepository,
  MembershipRecord,
  MembershipRepository,
  ModuleRecord,
  ModuleRepository,
  ProctorEventRecord,
  ProctorEventRepository,
  ProgressRepository,
  ProjectComponentRecord,
  ProjectComponentRepository,
  ProjectForkRecord,
  ProjectForkRepository,
  ProjectRecord,
  ProjectRepository,
  ProjectSubmissionRecord,
  ProjectSubmissionRepository,
  ProjectWorkspaceRecord,
  ProjectWorkspaceRepository,
  QualityEvaluationRecord,
  QualityEvaluationRepository,
  ReplayGuard,
  SnippetRecord,
  SnippetRepository,
  SupportIssueRecord,
  SupportIssueRepository,
  TenantRecord,
  TenantRepository,
  UserRecord,
  UserRepository,
  BankQuestionRecord,
  BankQuestionRepository,
  DepartmentRecord,
  DepartmentRepository,
  InterviewAttemptRecord,
  InterviewAttemptRepository,
  ClarityAttemptRecord,
  ClarityAttemptRepository,
  MentorMessageRecord,
  MentorMessageRepository,
  SkillPassportRecord,
  SkillPassportRepository,
  SocialFollowRecord,
  SocialFollowRepository,
  SocialPostRecord,
  SocialPostRepository,
} from './ports';

/**
 * Prisma-backed adapters for the repository ports. Selected at boot when a
 * database is configured (see `createRepositories` in ../demo/state.ts); the
 * in-memory adapters remain the default for unit tests.
 *
 * Each adapter maps the Prisma row onto the port's record shape so business
 * logic never sees Prisma types. Fields are projected explicitly rather than
 * spreading the row, so a schema change surfaces here rather than silently
 * leaking a column into the domain layer.
 */

export class PrismaTenantRepository implements TenantRepository {
  constructor(private readonly db: PrismaClient) {}
  async findById(id: string): Promise<TenantRecord | null> {
    const t = await this.db.tenant.findUnique({ where: { id } });
    return t ? toTenant(t) : null;
  }
  async findByDomain(domain: string): Promise<TenantRecord | null> {
    const t = await this.db.tenant.findUnique({ where: { domain } });
    return t ? toTenant(t) : null;
  }
}

export class PrismaUserRepository implements UserRepository {
  constructor(private readonly db: PrismaClient) {}
  async findByEmail(email: string): Promise<UserRecord | null> {
    const u = await this.db.user.findUnique({ where: { email } });
    return u ? toUser(u) : null;
  }
  async findById(id: string): Promise<UserRecord | null> {
    const u = await this.db.user.findUnique({ where: { id } });
    return u ? toUser(u) : null;
  }
  async upsertByEmail(email: string, fullName: string): Promise<UserRecord> {
    const u = await this.db.user.upsert({
      where: { email },
      update: {},
      create: { email, fullName },
    });
    return toUser(u);
  }
}

export class PrismaMembershipRepository implements MembershipRepository {
  constructor(private readonly db: PrismaClient) {}
  async find(userId: string, tenantId: string): Promise<MembershipRecord | null> {
    const m = await this.db.membership.findUnique({
      where: { userId_tenantId: { userId, tenantId } },
    });
    return m ? toMembership(m) : null;
  }
  async listByTenant(tenantId: string): Promise<MembershipRecord[]> {
    const rows = await this.db.membership.findMany({ where: { tenantId } });
    return rows.map(toMembership);
  }
  async create(
    userId: string,
    tenantId: string,
    role: string,
  ): Promise<MembershipRecord> {
    const m = await this.db.membership.create({
      data: { userId, tenantId, role },
    });
    return toMembership(m);
  }
}

export class PrismaLessonRepository implements LessonRepository {
  constructor(private readonly db: PrismaClient) {}
  async findById(id: string): Promise<LessonRecord | null> {
    const l = await this.db.lesson.findUnique({ where: { id } });
    return l ? toLesson(l) : null;
  }
  async findByExerciseSlug(exerciseSlug: string): Promise<LessonRecord | null> {
    const l = await this.db.lesson.findFirst({ where: { exerciseSlug } });
    return l ? toLesson(l) : null;
  }
  async create(input: Omit<LessonRecord, 'id'>): Promise<LessonRecord> {
    const l = await this.db.lesson.create({
      data: {
        moduleId: input.moduleId,
        title: input.title,
        type: input.type,
        position: input.position ?? 0,
        labProvider: input.labProvider ?? null,
        exerciseSlug: input.exerciseSlug ?? null,
        runtimeTier: input.runtimeTier ?? null,
        maxScore: input.maxScore,
        hint: input.hint ?? null,
        body: input.body ?? null,
        assessmentId: input.assessmentId ?? null,
      },
    });
    return toLesson(l);
  }
  async update(id: string, patch: Partial<LessonRecord>): Promise<LessonRecord> {
    const l = await this.db.lesson.update({ where: { id }, data: patch });
    return toLesson(l);
  }
  async delete(id: string): Promise<void> {
    await this.db.lesson.delete({ where: { id } });
  }
  async listByModule(moduleId: string): Promise<LessonRecord[]> {
    const rows = await this.db.lesson.findMany({
      where: { moduleId },
      orderBy: { position: 'asc' },
    });
    return rows.map(toLesson);
  }
}

function toLesson(l: {
  id: string;
  moduleId: string;
  title: string;
  type: string;
  position: number;
  labProvider: string | null;
  exerciseSlug: string | null;
  runtimeTier: string | null;
  maxScore: number;
  hint: string | null;
  body: string | null;
  assessmentId: string | null;
}): LessonRecord {
  return {
    id: l.id,
    moduleId: l.moduleId,
    title: l.title,
    type: l.type,
    position: l.position,
    labProvider: l.labProvider,
    exerciseSlug: l.exerciseSlug,
    runtimeTier: l.runtimeTier,
    maxScore: l.maxScore,
    hint: l.hint,
    body: l.body,
    assessmentId: l.assessmentId,
  };
}

export class PrismaCourseRepository implements CourseRepository {
  constructor(private readonly db: PrismaClient) {}
  async create(input: Omit<CourseRecord, 'id' | 'createdAt'>): Promise<CourseRecord> {
    const c = await this.db.course.create({ data: input });
    return toCourse(c);
  }
  async findById(id: string): Promise<CourseRecord | null> {
    const c = await this.db.course.findUnique({ where: { id } });
    return c ? toCourse(c) : null;
  }
  async findBySlug(tenantId: string, slug: string): Promise<CourseRecord | null> {
    const c = await this.db.course.findFirst({ where: { tenantId, slug } });
    return c ? toCourse(c) : null;
  }
  async listByTenant(tenantId: string): Promise<CourseRecord[]> {
    const rows = await this.db.course.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toCourse);
  }
  async update(id: string, patch: Partial<CourseRecord>): Promise<CourseRecord> {
    const c = await this.db.course.update({ where: { id }, data: patch });
    return toCourse(c);
  }
  async delete(id: string): Promise<void> {
    await this.db.course.delete({ where: { id } });
  }
}

function toCourse(c: {
  id: string;
  tenantId: string;
  slug: string;
  title: string;
  description: string | null;
  status: string;
  createdAt: Date;
}): CourseRecord {
  return {
    id: c.id,
    tenantId: c.tenantId,
    slug: c.slug,
    title: c.title,
    description: c.description ?? '',
    status: c.status,
    createdAt: c.createdAt,
  };
}

export class PrismaModuleRepository implements ModuleRepository {
  constructor(private readonly db: PrismaClient) {}
  async create(input: Omit<ModuleRecord, 'id'>): Promise<ModuleRecord> {
    const m = await this.db.module.create({ data: input });
    return m;
  }
  async findById(id: string): Promise<ModuleRecord | null> {
    return this.db.module.findUnique({ where: { id } });
  }
  async listByCourse(courseId: string): Promise<ModuleRecord[]> {
    return this.db.module.findMany({ where: { courseId }, orderBy: { position: 'asc' } });
  }
  async update(id: string, patch: Partial<ModuleRecord>): Promise<ModuleRecord> {
    return this.db.module.update({ where: { id }, data: patch });
  }
  async delete(id: string): Promise<void> {
    await this.db.module.delete({ where: { id } });
  }
}

export class PrismaProgressRepository implements ProgressRepository {
  constructor(private readonly db: PrismaClient) {}
  async findByUserAndLesson(
    userId: string,
    lessonId: string,
  ): Promise<LessonProgressRecord | null> {
    const p = await this.db.lessonProgress.findUnique({
      where: { userId_lessonId: { userId, lessonId } },
    });
    return p ? toProgress(p) : null;
  }
  async upsert(
    userId: string,
    lessonId: string,
    patch: Partial<LessonProgressRecord>,
  ): Promise<LessonProgressRecord> {
    const data = {
      status: patch.status ?? 'not_started',
      score: patch.score ?? undefined,
      attempts: patch.attempts ?? 0,
      completedAt: patch.completedAt ?? undefined,
    };
    const p = await this.db.lessonProgress.upsert({
      where: { userId_lessonId: { userId, lessonId } },
      update: data,
      create: { userId, lessonId, ...data },
    });
    return toProgress(p);
  }
  async listByUsers(userIds: string[]): Promise<LessonProgressRecord[]> {
    if (userIds.length === 0) return [];
    const rows = await this.db.lessonProgress.findMany({
      where: { userId: { in: userIds } },
    });
    return rows.map(toProgress);
  }
}

export class PrismaBatchRepository implements BatchRepository {
  constructor(private readonly db: PrismaClient) {}
  async create(input: {
    tenantId: string;
    name: string;
    departmentId?: string | null;
    startDate?: Date | null;
    endDate?: Date | null;
  }): Promise<BatchRecord> {
    const b = await this.db.academicBatch.create({
      data: {
        tenantId: input.tenantId,
        name: input.name,
        departmentId: input.departmentId ?? null,
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
      },
    });
    return toBatch(b);
  }
  async findById(id: string): Promise<BatchRecord | null> {
    const b = await this.db.academicBatch.findUnique({ where: { id } });
    return b ? toBatch(b) : null;
  }
  async listByTenant(tenantId: string): Promise<BatchRecord[]> {
    const rows = await this.db.academicBatch.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toBatch);
  }
}

export class PrismaEnrollmentRepository implements EnrollmentRepository {
  constructor(private readonly db: PrismaClient) {}
  async assign(input: {
    userId: string;
    courseId: string;
    batchId?: string | null;
  }): Promise<EnrollmentRecord> {
    // Upsert on the (userId, courseId) unique key: re-assigning the same course
    // updates the batch instead of violating the constraint.
    const e = await this.db.enrollment.upsert({
      where: { userId_courseId: { userId: input.userId, courseId: input.courseId } },
      update: input.batchId == null ? {} : { batchId: input.batchId },
      create: {
        userId: input.userId,
        courseId: input.courseId,
        batchId: input.batchId ?? null,
      },
    });
    return toEnrollment(e);
  }
  async listByBatch(batchId: string): Promise<EnrollmentRecord[]> {
    const rows = await this.db.enrollment.findMany({ where: { batchId } });
    return rows.map(toEnrollment);
  }
  async listByUser(userId: string): Promise<EnrollmentRecord[]> {
    const rows = await this.db.enrollment.findMany({ where: { userId } });
    return rows.map(toEnrollment);
  }
}

export class PrismaClassSessionRepository implements ClassSessionRepository {
  constructor(private readonly db: PrismaClient) {}
  async create(input: {
    batchId: string;
    title: string;
    scheduledAt: Date;
  }): Promise<ClassSessionRecord> {
    const s = await this.db.classSession.create({
      data: {
        batchId: input.batchId,
        title: input.title,
        scheduledAt: input.scheduledAt,
      },
    });
    return toClassSession(s);
  }
  async findById(id: string): Promise<ClassSessionRecord | null> {
    const s = await this.db.classSession.findUnique({ where: { id } });
    return s ? toClassSession(s) : null;
  }
  async listByBatch(batchId: string): Promise<ClassSessionRecord[]> {
    const rows = await this.db.classSession.findMany({
      where: { batchId },
      orderBy: { scheduledAt: 'asc' },
    });
    return rows.map(toClassSession);
  }
}

export class PrismaAttendanceRepository implements AttendanceRepository {
  constructor(private readonly db: PrismaClient) {}
  async mark(input: {
    sessionId: string;
    userId: string;
    status: string;
    markedBy?: string | null;
  }): Promise<AttendanceRecord> {
    // Upsert on the (session, user) unique key: a correction updates the row.
    const a = await this.db.attendanceRecord.upsert({
      where: {
        sessionId_userId: { sessionId: input.sessionId, userId: input.userId },
      },
      update: { status: input.status, markedBy: input.markedBy ?? null },
      create: {
        sessionId: input.sessionId,
        userId: input.userId,
        status: input.status,
        markedBy: input.markedBy ?? null,
      },
    });
    return toAttendance(a);
  }
  async listBySession(sessionId: string): Promise<AttendanceRecord[]> {
    const rows = await this.db.attendanceRecord.findMany({ where: { sessionId } });
    return rows.map(toAttendance);
  }
  async listBySessions(sessionIds: string[]): Promise<AttendanceRecord[]> {
    if (sessionIds.length === 0) return [];
    const rows = await this.db.attendanceRecord.findMany({
      where: { sessionId: { in: sessionIds } },
    });
    return rows.map(toAttendance);
  }
  async listByUser(userId: string): Promise<AttendanceRecord[]> {
    const rows = await this.db.attendanceRecord.findMany({ where: { userId } });
    return rows.map(toAttendance);
  }
}

export class PrismaLabSessionRepository implements LabSessionRepository {
  constructor(private readonly db: PrismaClient) {}
  async create(input: Omit<LabSessionRecord, 'id'>): Promise<LabSessionRecord> {
    const s = await this.db.labSession.create({
      data: {
        tenantId: input.tenantId,
        userId: input.userId,
        exerciseSlug: input.exerciseSlug,
        tier: input.tier,
        status: input.status,
        ideHost: input.ideHost ?? null,
        kubelabRef: input.kubelabRef ?? null,
        startedAt: input.startedAt,
        lastActivityAt: input.lastActivityAt,
        ttlSeconds: input.ttlSeconds,
      },
    });
    return toLabSession(s);
  }
  async findById(id: string): Promise<LabSessionRecord | null> {
    const s = await this.db.labSession.findUnique({ where: { id } });
    return s ? toLabSession(s) : null;
  }
  async countActiveByTenant(tenantId: string): Promise<number> {
    return this.db.labSession.count({
      where: {
        tenantId,
        status: { in: ['WARM', 'ACTIVE', 'IDLE'] },
      },
    });
  }
  async listByTenant(tenantId: string): Promise<LabSessionRecord[]> {
    const rows = await this.db.labSession.findMany({
      where: { tenantId },
      orderBy: { startedAt: 'asc' },
    });
    return rows.map(toLabSession);
  }
  async update(
    id: string,
    patch: Partial<LabSessionRecord>,
  ): Promise<LabSessionRecord> {
    const s = await this.db.labSession.update({
      where: { id },
      data: {
        status: patch.status,
        ideHost: patch.ideHost === undefined ? undefined : patch.ideHost,
        kubelabRef: patch.kubelabRef === undefined ? undefined : patch.kubelabRef,
        lastActivityAt: patch.lastActivityAt,
        ttlSeconds: patch.ttlSeconds,
      },
    });
    return toLabSession(s);
  }
}

export class PrismaSnippetRepository implements SnippetRepository {
  constructor(private readonly db: PrismaClient) {}
  async create(input: {
    userId: string;
    language: string;
    title: string;
    source: string;
    stdin: string;
  }): Promise<SnippetRecord> {
    const s = await this.db.codeSnippet.create({
      data: {
        userId: input.userId,
        language: input.language,
        title: input.title,
        source: input.source,
        stdin: input.stdin,
      },
    });
    return toSnippet(s);
  }
  async update(
    id: string,
    userId: string,
    patch: Partial<Pick<SnippetRecord, 'title' | 'language' | 'source' | 'stdin'>>,
  ): Promise<SnippetRecord | null> {
    // updateMany scopes by userId in the WHERE, so a user cannot update a row
    // they do not own; count tells us whether it matched.
    const result = await this.db.codeSnippet.updateMany({
      where: { id, userId },
      data: {
        title: patch.title,
        language: patch.language,
        source: patch.source,
        stdin: patch.stdin,
      },
    });
    if (result.count === 0) return null;
    const s = await this.db.codeSnippet.findUnique({ where: { id } });
    return s ? toSnippet(s) : null;
  }
  async listByUser(userId: string): Promise<SnippetRecord[]> {
    const rows = await this.db.codeSnippet.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    });
    return rows.map(toSnippet);
  }
  async findById(id: string, userId: string): Promise<SnippetRecord | null> {
    const s = await this.db.codeSnippet.findFirst({ where: { id, userId } });
    return s ? toSnippet(s) : null;
  }
  async delete(id: string, userId: string): Promise<boolean> {
    const result = await this.db.codeSnippet.deleteMany({ where: { id, userId } });
    return result.count > 0;
  }
}

export class PrismaAttemptRepository implements AttemptRepository {
  constructor(private readonly db: PrismaClient) {}
  async create(input: {
    userId: string;
    assessmentId: string;
    startedAt: Date;
    endsAt: Date | null;
  }): Promise<AttemptRecord> {
    const row = await this.db.attempt.create({
      data: {
        userId: input.userId,
        assessmentId: input.assessmentId,
        startedAt: input.startedAt,
        endsAt: input.endsAt,
        status: 'in_progress',
      },
    });
    return toAttempt(row);
  }
  async findById(id: string): Promise<AttemptRecord | null> {
    const row = await this.db.attempt.findUnique({ where: { id } });
    return row ? toAttempt(row) : null;
  }
  async findOpen(userId: string, assessmentId: string): Promise<AttemptRecord | null> {
    const row = await this.db.attempt.findFirst({
      where: { userId, assessmentId, status: 'in_progress' },
      orderBy: { startedAt: 'desc' },
    });
    return row ? toAttempt(row) : null;
  }
  async listByUser(userId: string): Promise<AttemptRecord[]> {
    const rows = await this.db.attempt.findMany({
      where: { userId },
      orderBy: { startedAt: 'desc' },
    });
    return rows.map(toAttempt);
  }
  async update(id: string, patch: Partial<AttemptRecord>): Promise<AttemptRecord> {
    const row = await this.db.attempt.update({ where: { id }, data: patch });
    return toAttempt(row);
  }
}

export class PrismaProctorEventRepository implements ProctorEventRepository {
  constructor(private readonly db: PrismaClient) {}
  async record(input: {
    attemptId: string;
    type: string;
    payload?: string | null;
  }): Promise<ProctorEventRecord> {
    const row = await this.db.proctoringEvent.create({
      data: { attemptId: input.attemptId, type: input.type, payload: input.payload ?? null },
    });
    return toProctorEvent(row);
  }
  async listByAttempt(attemptId: string): Promise<ProctorEventRecord[]> {
    const rows = await this.db.proctoringEvent.findMany({
      where: { attemptId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toProctorEvent);
  }
  async listByAttempts(attemptIds: string[]): Promise<ProctorEventRecord[]> {
    if (attemptIds.length === 0) return [];
    const rows = await this.db.proctoringEvent.findMany({
      where: { attemptId: { in: attemptIds } },
    });
    return rows.map(toProctorEvent);
  }
}

export class PrismaEventLedger implements EventLedger {
  constructor(private readonly db: PrismaClient) {}
  async recordIfNew(eventId: string, source: string): Promise<boolean> {
    // createMany + skipDuplicates is atomic on the primary key, so a duplicate
    // delivery is rejected without a read-then-write race.
    const result = await this.db.processedEvent.createMany({
      data: [{ eventId, source }],
      skipDuplicates: true,
    });
    return result.count > 0;
  }
}

export class PrismaReplayGuard implements ReplayGuard {
  constructor(private readonly db: PrismaClient) {}
  async claim(jti: string, partnerId: string): Promise<boolean> {
    const result = await this.db.partnerSsoReplay.createMany({
      data: [{ jti, partnerId }],
      skipDuplicates: true,
    });
    return result.count > 0;
  }
}

// ---------------------------------------------------------------- Projects

export class PrismaProjectRepository implements ProjectRepository {
  constructor(private readonly db: PrismaClient) {}
  async create(
    input: Omit<ProjectRecord, 'id' | 'createdAt'>,
  ): Promise<ProjectRecord> {
    const p = await this.db.project.create({ data: input });
    return toProject(p);
  }
  async findById(id: string): Promise<ProjectRecord | null> {
    const p = await this.db.project.findUnique({ where: { id } });
    return p ? toProject(p) : null;
  }
  async listByTenant(tenantId: string): Promise<ProjectRecord[]> {
    const rows = await this.db.project.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toProject);
  }
  async update(id: string, patch: Partial<ProjectRecord>): Promise<ProjectRecord> {
    const p = await this.db.project.update({ where: { id }, data: patch });
    return toProject(p);
  }
}

export class PrismaProjectComponentRepository implements ProjectComponentRepository {
  constructor(private readonly db: PrismaClient) {}
  async create(
    input: Omit<ProjectComponentRecord, 'id' | 'createdAt'>,
  ): Promise<ProjectComponentRecord> {
    const c = await this.db.projectComponent.create({ data: input });
    return toProjectComponent(c);
  }
  async findById(id: string): Promise<ProjectComponentRecord | null> {
    const c = await this.db.projectComponent.findUnique({ where: { id } });
    return c ? toProjectComponent(c) : null;
  }
  async listByProject(projectId: string): Promise<ProjectComponentRecord[]> {
    const rows = await this.db.projectComponent.findMany({
      where: { projectId },
      orderBy: { position: 'asc' },
    });
    return rows.map(toProjectComponent);
  }
}

export class PrismaProjectWorkspaceRepository implements ProjectWorkspaceRepository {
  constructor(private readonly db: PrismaClient) {}
  async create(
    input: Omit<
      ProjectWorkspaceRecord,
      | 'id'
      | 'createdAt'
      | 'lastActivityAt'
      | 'deployUrl'
      | 'deployPort'
      | 'qualityScore'
      | 'qualityReport'
      | 'analyzedAt'
    > & {
      deployUrl?: string | null;
      deployPort?: number | null;
      qualityScore?: number | null;
      qualityReport?: string | null;
      analyzedAt?: Date | null;
    },
  ): Promise<ProjectWorkspaceRecord> {
    const w = await this.db.projectWorkspace.create({
      data: { deployUrl: null, deployPort: null, ...input },
    });
    return toProjectWorkspace(w);
  }
  async findById(id: string): Promise<ProjectWorkspaceRecord | null> {
    const w = await this.db.projectWorkspace.findUnique({ where: { id } });
    return w ? toProjectWorkspace(w) : null;
  }
  async listByUser(
    tenantId: string,
    userId: string,
  ): Promise<ProjectWorkspaceRecord[]> {
    const rows = await this.db.projectWorkspace.findMany({
      where: { tenantId, userId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toProjectWorkspace);
  }
  async countByTenant(tenantId: string): Promise<number> {
    return this.db.projectWorkspace.count({ where: { tenantId } });
  }
  async update(
    id: string,
    patch: Partial<ProjectWorkspaceRecord>,
  ): Promise<ProjectWorkspaceRecord> {
    const w = await this.db.projectWorkspace.update({ where: { id }, data: patch });
    return toProjectWorkspace(w);
  }
  async delete(id: string): Promise<void> {
    await this.db.projectWorkspace.delete({ where: { id } });
  }
}

export class PrismaProjectForkRepository implements ProjectForkRepository {
  constructor(private readonly db: PrismaClient) {}
  async create(
    input: Omit<ProjectForkRecord, 'id' | 'createdAt'>,
  ): Promise<ProjectForkRecord> {
    const f = await this.db.projectFork.create({ data: input });
    return toProjectFork(f);
  }
  async findById(id: string): Promise<ProjectForkRecord | null> {
    const f = await this.db.projectFork.findUnique({ where: { id } });
    return f ? toProjectFork(f) : null;
  }
  async findByComponentAndUser(
    componentId: string,
    userId: string,
  ): Promise<ProjectForkRecord | null> {
    const f = await this.db.projectFork.findUnique({
      where: { componentId_userId: { componentId, userId } },
    });
    return f ? toProjectFork(f) : null;
  }
  async listByProjectAndUser(
    projectId: string,
    userId: string,
  ): Promise<ProjectForkRecord[]> {
    const rows = await this.db.projectFork.findMany({
      where: { projectId, userId },
    });
    return rows.map(toProjectFork);
  }
  async listByProject(projectId: string): Promise<ProjectForkRecord[]> {
    const rows = await this.db.projectFork.findMany({ where: { projectId } });
    return rows.map(toProjectFork);
  }
  async findByWorkspaceId(workspaceId: string): Promise<ProjectForkRecord | null> {
    const f = await this.db.projectFork.findFirst({ where: { workspaceId } });
    return f ? toProjectFork(f) : null;
  }
  async delete(id: string): Promise<void> {
    await this.db.projectFork.delete({ where: { id } });
  }
}

export class PrismaProjectSubmissionRepository
  implements ProjectSubmissionRepository
{
  constructor(private readonly db: PrismaClient) {}
  async create(
    input: Omit<
      ProjectSubmissionRecord,
      'id' | 'submittedAt' | 'evaluatedAt' | 'autoScore' | 'autoReport' | 'autoEvaluatedAt'
    > & {
      autoScore?: number | null;
      autoReport?: string | null;
      autoEvaluatedAt?: Date | null;
    },
  ): Promise<ProjectSubmissionRecord> {
    const s = await this.db.projectSubmission.create({
      data: { autoScore: null, autoReport: null, autoEvaluatedAt: null, ...input },
    });
    return toProjectSubmission(s);
  }
  async findById(id: string): Promise<ProjectSubmissionRecord | null> {
    const s = await this.db.projectSubmission.findUnique({ where: { id } });
    return s ? toProjectSubmission(s) : null;
  }
  async listByProject(
    tenantId: string,
    projectId: string,
  ): Promise<ProjectSubmissionRecord[]> {
    const rows = await this.db.projectSubmission.findMany({
      where: { tenantId, projectId },
      orderBy: { submittedAt: 'desc' },
    });
    return rows.map(toProjectSubmission);
  }
  async listByUser(
    tenantId: string,
    userId: string,
  ): Promise<ProjectSubmissionRecord[]> {
    const rows = await this.db.projectSubmission.findMany({
      where: { tenantId, userId },
      orderBy: { submittedAt: 'desc' },
    });
    return rows.map(toProjectSubmission);
  }
  async update(
    id: string,
    patch: Partial<ProjectSubmissionRecord>,
  ): Promise<ProjectSubmissionRecord> {
    const s = await this.db.projectSubmission.update({ where: { id }, data: patch });
    return toProjectSubmission(s);
  }
}

export class PrismaGitConnectionRepository implements GitConnectionRepository {
  constructor(private readonly db: PrismaClient) {}
  async findByUser(userId: string, provider: string): Promise<GitConnectionRecord | null> {
    const row = await this.db.gitConnection.findUnique({
      where: { userId_provider: { userId, provider } },
    });
    return row ? toGitConnection(row) : null;
  }
  async upsert(
    input: Omit<GitConnectionRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<GitConnectionRecord> {
    const row = await this.db.gitConnection.upsert({
      where: { userId_provider: { userId: input.userId, provider: input.provider } },
      create: input,
      update: input,
    });
    return toGitConnection(row);
  }
  async delete(userId: string, provider: string): Promise<boolean> {
    const result = await this.db.gitConnection.deleteMany({ where: { userId, provider } });
    return result.count > 0;
  }
}

export class PrismaGitPublishRepository implements GitPublishRepository {
  constructor(private readonly db: PrismaClient) {}
  async create(input: Omit<GitPublishRecord, 'id' | 'createdAt'>): Promise<GitPublishRecord> {
    const row = await this.db.gitPublish.create({ data: input });
    return toGitPublish(row);
  }
  async listByWorkspace(workspaceId: string): Promise<GitPublishRecord[]> {
    const rows = await this.db.gitPublish.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toGitPublish);
  }
  async latestByWorkspace(workspaceId: string): Promise<GitPublishRecord | null> {
    const row = await this.db.gitPublish.findFirst({
      where: { workspaceId, status: 'succeeded' },
      orderBy: { createdAt: 'desc' },
    });
    return row ? toGitPublish(row) : null;
  }
}

export class PrismaQualityEvaluationRepository implements QualityEvaluationRepository {
  constructor(private readonly db: PrismaClient) {}
  async create(
    input: Omit<QualityEvaluationRecord, 'id' | 'createdAt'>,
  ): Promise<QualityEvaluationRecord> {
    const row = await this.db.qualityEvaluation.create({ data: input });
    return toQualityEvaluation(row);
  }
  async listByWorkspace(workspaceId: string): Promise<QualityEvaluationRecord[]> {
    const rows = await this.db.qualityEvaluation.findMany({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toQualityEvaluation);
  }
  async latestByWorkspace(workspaceId: string): Promise<QualityEvaluationRecord | null> {
    const row = await this.db.qualityEvaluation.findFirst({
      where: { workspaceId },
      orderBy: { createdAt: 'desc' },
    });
    return row ? toQualityEvaluation(row) : null;
  }
}

export class PrismaSupportIssueRepository implements SupportIssueRepository {
  constructor(private readonly db: PrismaClient) {}
  async create(
    input: Omit<SupportIssueRecord, 'id' | 'createdAt'>,
  ): Promise<SupportIssueRecord> {
    const row = await this.db.supportIssue.create({ data: input });
    return toSupportIssue(row);
  }
  async findById(id: string): Promise<SupportIssueRecord | null> {
    const row = await this.db.supportIssue.findUnique({ where: { id } });
    return row ? toSupportIssue(row) : null;
  }
  async listByTenant(tenantId: string): Promise<SupportIssueRecord[]> {
    const rows = await this.db.supportIssue.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toSupportIssue);
  }
  async update(
    id: string,
    patch: Partial<SupportIssueRecord>,
  ): Promise<SupportIssueRecord> {
    const row = await this.db.supportIssue.update({ where: { id }, data: patch });
    return toSupportIssue(row);
  }
}

// ---------------------------------------------------------------- P3 adapters

export class PrismaSkillPassportRepository implements SkillPassportRepository {
  constructor(private readonly db: PrismaClient) {}
  async find(userId: string, tenantId: string): Promise<SkillPassportRecord | null> {
    const row = await this.db.skillPassport.findUnique({
      where: { userId_tenantId: { userId, tenantId } },
    });
    return row ? toSkillPassport(row) : null;
  }
  async upsert(
    input: Omit<SkillPassportRecord, 'id' | 'updatedAt'>,
  ): Promise<SkillPassportRecord> {
    const row = await this.db.skillPassport.upsert({
      where: { userId_tenantId: { userId: input.userId, tenantId: input.tenantId } },
      update: {
        verifiedBadges: input.verifiedBadges,
        bestContestRank: input.bestContestRank,
        avgLabScore: input.avgLabScore,
        communicationScore: input.communicationScore,
      },
      create: {
        userId: input.userId,
        tenantId: input.tenantId,
        verifiedBadges: input.verifiedBadges,
        bestContestRank: input.bestContestRank,
        avgLabScore: input.avgLabScore,
        communicationScore: input.communicationScore,
      },
    });
    return toSkillPassport(row);
  }
  async listByTenant(tenantId: string): Promise<SkillPassportRecord[]> {
    const rows = await this.db.skillPassport.findMany({ where: { tenantId } });
    return rows.map(toSkillPassport);
  }
}

export class PrismaInterviewAttemptRepository implements InterviewAttemptRepository {
  constructor(private readonly db: PrismaClient) {}
  async create(
    input: Omit<InterviewAttemptRecord, 'id' | 'createdAt'>,
  ): Promise<InterviewAttemptRecord> {
    const row = await this.db.interviewAttempt.create({ data: input });
    return toInterviewAttempt(row);
  }
  async listByUser(userId: string): Promise<InterviewAttemptRecord[]> {
    const rows = await this.db.interviewAttempt.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toInterviewAttempt);
  }
  async latestByUser(userId: string): Promise<InterviewAttemptRecord | null> {
    const row = await this.db.interviewAttempt.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return row ? toInterviewAttempt(row) : null;
  }
}

export class PrismaClarityAttemptRepository implements ClarityAttemptRepository {
  constructor(private readonly db: PrismaClient) {}
  async create(
    input: Omit<ClarityAttemptRecord, 'id' | 'createdAt'>,
  ): Promise<ClarityAttemptRecord> {
    const row = await this.db.clarityAttempt.create({ data: input });
    return toClarityAttempt(row);
  }
  async listByUser(userId: string): Promise<ClarityAttemptRecord[]> {
    const rows = await this.db.clarityAttempt.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toClarityAttempt);
  }
  async listByTenant(tenantId: string): Promise<ClarityAttemptRecord[]> {
    const rows = await this.db.clarityAttempt.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toClarityAttempt);
  }
}

export class PrismaMentorMessageRepository implements MentorMessageRepository {
  constructor(private readonly db: PrismaClient) {}
  async create(
    input: Omit<MentorMessageRecord, 'id' | 'createdAt'>,
  ): Promise<MentorMessageRecord> {
    const row = await this.db.mentorMessage.create({ data: input });
    return toMentorMessage(row);
  }
  async listByUser(userId: string): Promise<MentorMessageRecord[]> {
    const rows = await this.db.mentorMessage.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toMentorMessage);
  }
  async clearByUser(userId: string): Promise<void> {
    await this.db.mentorMessage.deleteMany({ where: { userId } });
  }
}

export class PrismaBankQuestionRepository implements BankQuestionRepository {
  constructor(private readonly db: PrismaClient) {}
  async create(
    input: Omit<BankQuestionRecord, 'id' | 'createdAt'>,
  ): Promise<BankQuestionRecord> {
    const row = await this.db.bankQuestion.create({ data: input });
    return toBankQuestion(row);
  }
  async findById(id: string): Promise<BankQuestionRecord | null> {
    const row = await this.db.bankQuestion.findUnique({ where: { id } });
    return row ? toBankQuestion(row) : null;
  }
  async listByTenant(tenantId: string): Promise<BankQuestionRecord[]> {
    const rows = await this.db.bankQuestion.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toBankQuestion);
  }
  async update(
    id: string,
    patch: Partial<BankQuestionRecord>,
  ): Promise<BankQuestionRecord> {
    const row = await this.db.bankQuestion.update({ where: { id }, data: patch });
    return toBankQuestion(row);
  }
  async delete(id: string): Promise<void> {
    await this.db.bankQuestion.delete({ where: { id } });
  }
}

export class PrismaSocialPostRepository implements SocialPostRepository {
  constructor(private readonly db: PrismaClient) {}
  async create(
    input: Omit<SocialPostRecord, 'id' | 'createdAt'>,
  ): Promise<SocialPostRecord> {
    const row = await this.db.socialPost.create({ data: input });
    return toSocialPost(row);
  }
  async findById(id: string): Promise<SocialPostRecord | null> {
    const row = await this.db.socialPost.findUnique({ where: { id } });
    return row ? toSocialPost(row) : null;
  }
  async listByTenant(tenantId: string): Promise<SocialPostRecord[]> {
    const rows = await this.db.socialPost.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toSocialPost);
  }
  async listByUsers(tenantId: string, userIds: string[]): Promise<SocialPostRecord[]> {
    const rows = await this.db.socialPost.findMany({
      where: { tenantId, userId: { in: userIds } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toSocialPost);
  }
  async delete(id: string): Promise<void> {
    await this.db.socialPost.delete({ where: { id } });
  }
}

export class PrismaSocialFollowRepository implements SocialFollowRepository {
  constructor(private readonly db: PrismaClient) {}
  async follow(
    input: Omit<SocialFollowRecord, 'id' | 'createdAt'>,
  ): Promise<SocialFollowRecord> {
    const row = await this.db.socialFollow.upsert({
      where: {
        followerId_followeeId: {
          followerId: input.followerId,
          followeeId: input.followeeId,
        },
      },
      update: {},
      create: input,
    });
    return toSocialFollow(row);
  }
  async unfollow(followerId: string, followeeId: string): Promise<boolean> {
    const result = await this.db.socialFollow.deleteMany({
      where: { followerId, followeeId },
    });
    return result.count > 0;
  }
  async listFollowing(
    tenantId: string,
    followerId: string,
  ): Promise<SocialFollowRecord[]> {
    const rows = await this.db.socialFollow.findMany({
      where: { tenantId, followerId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toSocialFollow);
  }
  async listFollowers(
    tenantId: string,
    followeeId: string,
  ): Promise<SocialFollowRecord[]> {
    const rows = await this.db.socialFollow.findMany({
      where: { tenantId, followeeId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toSocialFollow);
  }
}

export class PrismaDepartmentRepository implements DepartmentRepository {
  constructor(private readonly db: PrismaClient) {}
  async create(
    input: Omit<DepartmentRecord, 'id' | 'createdAt'>,
  ): Promise<DepartmentRecord> {
    const row = await this.db.department.create({ data: input });
    return toDepartment(row);
  }
  async findById(id: string): Promise<DepartmentRecord | null> {
    const row = await this.db.department.findUnique({ where: { id } });
    return row ? toDepartment(row) : null;
  }
  async listByTenant(tenantId: string): Promise<DepartmentRecord[]> {
    const rows = await this.db.department.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
    });
    return rows.map(toDepartment);
  }
  async delete(id: string): Promise<void> {
    await this.db.department.delete({ where: { id } });
  }
}

// ---------------------------------------------------------------- Phase G adapters

export class PrismaContestRepository implements ContestRepository {
  constructor(private readonly db: PrismaClient) {}
  async create(
    input: Omit<ContestRecord, 'id' | 'createdAt'>,
  ): Promise<ContestRecord> {
    const row = await this.db.contest.create({ data: input });
    return toContest(row);
  }
  async findById(id: string): Promise<ContestRecord | null> {
    const row = await this.db.contest.findUnique({ where: { id } });
    return row ? toContest(row) : null;
  }
  async listByTenant(tenantId: string): Promise<ContestRecord[]> {
    const rows = await this.db.contest.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toContest);
  }
  async update(id: string, patch: Partial<ContestRecord>): Promise<ContestRecord> {
    const row = await this.db.contest.update({ where: { id }, data: patch });
    return toContest(row);
  }
  async delete(id: string): Promise<void> {
    await this.db.contest.delete({ where: { id } });
  }
}

export class PrismaContestEntryRepository implements ContestEntryRepository {
  constructor(private readonly db: PrismaClient) {}
  async upsertBest(
    input: Omit<ContestEntryRecord, 'id' | 'submittedAt'> & { submittedAt: Date },
  ): Promise<ContestEntryRecord> {
    const existing = await this.db.contestEntry.findUnique({
      where: { contestId_userId: { contestId: input.contestId, userId: input.userId } },
    });
    // Keep the best: higher score, then faster. An exact tie keeps the first.
    if (existing) {
      const better =
        input.score > existing.score ||
        (input.score === existing.score && input.durationMs < existing.durationMs);
      if (!better) return toContestEntry(existing);
    }
    const row = await this.db.contestEntry.upsert({
      where: { contestId_userId: { contestId: input.contestId, userId: input.userId } },
      update: {
        score: input.score,
        durationMs: input.durationMs,
        submittedAt: input.submittedAt,
      },
      create: input,
    });
    return toContestEntry(row);
  }
  async listByContest(contestId: string): Promise<ContestEntryRecord[]> {
    const rows = await this.db.contestEntry.findMany({
      where: { contestId },
      orderBy: [{ score: 'desc' }, { durationMs: 'asc' }],
    });
    return rows.map(toContestEntry);
  }
  async find(contestId: string, userId: string): Promise<ContestEntryRecord | null> {
    const row = await this.db.contestEntry.findUnique({
      where: { contestId_userId: { contestId, userId } },
    });
    return row ? toContestEntry(row) : null;
  }
  async listByUser(userId: string): Promise<ContestEntryRecord[]> {
    const rows = await this.db.contestEntry.findMany({ where: { userId } });
    return rows.map(toContestEntry);
  }
}

type TenantRow = Awaited<ReturnType<PrismaClient['tenant']['findUniqueOrThrow']>>;
type UserRow = Awaited<ReturnType<PrismaClient['user']['findUniqueOrThrow']>>;
type MembershipRow = Awaited<
  ReturnType<PrismaClient['membership']['findUniqueOrThrow']>
>;
type ProgressRow = Awaited<
  ReturnType<PrismaClient['lessonProgress']['findUniqueOrThrow']>
>;
type LabSessionRow = Awaited<
  ReturnType<PrismaClient['labSession']['findUniqueOrThrow']>
>;
type BatchRow = Awaited<
  ReturnType<PrismaClient['academicBatch']['findUniqueOrThrow']>
>;
type EnrollmentRow = Awaited<
  ReturnType<PrismaClient['enrollment']['findUniqueOrThrow']>
>;
type ClassSessionRow = Awaited<
  ReturnType<PrismaClient['classSession']['findUniqueOrThrow']>
>;
type AttendanceRow = Awaited<
  ReturnType<PrismaClient['attendanceRecord']['findUniqueOrThrow']>
>;
type SnippetRow = Awaited<
  ReturnType<PrismaClient['codeSnippet']['findUniqueOrThrow']>
>;
type AttemptRow = Awaited<
  ReturnType<PrismaClient['attempt']['findUniqueOrThrow']>
>;
type ProctorEventRow = Awaited<
  ReturnType<PrismaClient['proctoringEvent']['findUniqueOrThrow']>
>;
type ProjectRow = Awaited<
  ReturnType<PrismaClient['project']['findUniqueOrThrow']>
>;
type ProjectComponentRow = Awaited<
  ReturnType<PrismaClient['projectComponent']['findUniqueOrThrow']>
>;
type ProjectWorkspaceRow = Awaited<
  ReturnType<PrismaClient['projectWorkspace']['findUniqueOrThrow']>
>;
type ProjectForkRow = Awaited<
  ReturnType<PrismaClient['projectFork']['findUniqueOrThrow']>
>;
type ProjectSubmissionRow = Awaited<
  ReturnType<PrismaClient['projectSubmission']['findUniqueOrThrow']>
>;
type GitConnectionRow = Awaited<
  ReturnType<PrismaClient['gitConnection']['findUniqueOrThrow']>
>;
type GitPublishRow = Awaited<
  ReturnType<PrismaClient['gitPublish']['findUniqueOrThrow']>
>;
type QualityEvaluationRow = Awaited<
  ReturnType<PrismaClient['qualityEvaluation']['findUniqueOrThrow']>
>;
type SupportIssueRow = Awaited<
  ReturnType<PrismaClient['supportIssue']['findUniqueOrThrow']>
>;
type SkillPassportRow = Awaited<
  ReturnType<PrismaClient['skillPassport']['findUniqueOrThrow']>
>;
type InterviewAttemptRow = Awaited<
  ReturnType<PrismaClient['interviewAttempt']['findUniqueOrThrow']>
>;
type ClarityAttemptRow = Awaited<
  ReturnType<PrismaClient['clarityAttempt']['findUniqueOrThrow']>
>;
type MentorMessageRow = Awaited<
  ReturnType<PrismaClient['mentorMessage']['findUniqueOrThrow']>
>;
type BankQuestionRow = Awaited<
  ReturnType<PrismaClient['bankQuestion']['findUniqueOrThrow']>
>;
type SocialPostRow = Awaited<
  ReturnType<PrismaClient['socialPost']['findUniqueOrThrow']>
>;
type SocialFollowRow = Awaited<
  ReturnType<PrismaClient['socialFollow']['findUniqueOrThrow']>
>;
type DepartmentRow = Awaited<
  ReturnType<PrismaClient['department']['findUniqueOrThrow']>
>;
type ContestRow = Awaited<ReturnType<PrismaClient['contest']['findUniqueOrThrow']>>;
type ContestEntryRow = Awaited<
  ReturnType<PrismaClient['contestEntry']['findUniqueOrThrow']>
>;

function toTenant(t: TenantRow): TenantRecord {
  return {
    id: t.id,
    name: t.name,
    domain: t.domain,
    maxConcurrentLabs: t.maxConcurrentLabs,
    monthlyBudgetCents: t.monthlyBudgetCents,
    maxStorageGb: t.maxStorageGb,
    plan: t.plan,
    status: t.status,
  };
}

function toUser(u: UserRow): UserRecord {
  return { id: u.id, email: u.email, fullName: u.fullName };
}

function toMembership(m: MembershipRow): MembershipRecord {
  return {
    id: m.id,
    userId: m.userId,
    tenantId: m.tenantId,
    role: m.role,
    status: m.status,
  };
}

function toProgress(p: ProgressRow): LessonProgressRecord {
  return {
    id: p.id,
    userId: p.userId,
    lessonId: p.lessonId,
    status: p.status,
    score: p.score ?? null,
    attempts: p.attempts,
    completedAt: p.completedAt ?? null,
  };
}

function toLabSession(s: LabSessionRow): LabSessionRecord {
  return {
    id: s.id,
    tenantId: s.tenantId,
    userId: s.userId,
    exerciseSlug: s.exerciseSlug,
    tier: s.tier,
    status: s.status,
    ideHost: s.ideHost ?? null,
    kubelabRef: s.kubelabRef ?? null,
    startedAt: s.startedAt,
    lastActivityAt: s.lastActivityAt,
    ttlSeconds: s.ttlSeconds,
  };
}

function toBatch(b: BatchRow): BatchRecord {
  return {
    id: b.id,
    tenantId: b.tenantId,
    name: b.name,
    departmentId: b.departmentId ?? null,
    startDate: b.startDate ?? null,
    endDate: b.endDate ?? null,
  };
}

function toEnrollment(e: EnrollmentRow): EnrollmentRecord {
  return {
    id: e.id,
    userId: e.userId,
    courseId: e.courseId,
    batchId: e.batchId ?? null,
  };
}

function toClassSession(s: ClassSessionRow): ClassSessionRecord {
  return {
    id: s.id,
    batchId: s.batchId,
    title: s.title,
    scheduledAt: s.scheduledAt,
    createdAt: s.createdAt,
  };
}

function toAttendance(a: AttendanceRow): AttendanceRecord {
  return {
    id: a.id,
    sessionId: a.sessionId,
    userId: a.userId,
    status: a.status,
    markedBy: a.markedBy ?? null,
    markedAt: a.markedAt,
  };
}

function toSnippet(s: SnippetRow): SnippetRecord {
  return {
    id: s.id,
    userId: s.userId,
    language: s.language,
    title: s.title,
    source: s.source,
    stdin: s.stdin,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
  };
}

function toAttempt(a: AttemptRow): AttemptRecord {
  return {
    id: a.id,
    userId: a.userId,
    assessmentId: a.assessmentId,
    status: a.status,
    startedAt: a.startedAt,
    endsAt: a.endsAt ?? null,
    submittedAt: a.submittedAt ?? null,
    score: a.score ?? null,
    answers: a.answers ?? null,
    results: a.results ?? null,
  };
}

function toProctorEvent(e: ProctorEventRow): ProctorEventRecord {
  return {
    id: e.id,
    attemptId: e.attemptId,
    type: e.type,
    payload: e.payload ?? null,
    createdAt: e.createdAt,
  };
}

function toProject(p: ProjectRow): ProjectRecord {
  return {
    id: p.id,
    tenantId: p.tenantId,
    title: p.title,
    description: p.description,
    runtimeTier: p.runtimeTier,
    status: p.status,
    deadline: p.deadline ?? null,
    maxScore: p.maxScore,
    createdAt: p.createdAt,
  };
}

function toProjectComponent(c: ProjectComponentRow): ProjectComponentRecord {
  return {
    id: c.id,
    tenantId: c.tenantId,
    projectId: c.projectId,
    title: c.title,
    technology: c.technology,
    templateSlug: c.templateSlug ?? null,
    templateWorkspaceId: c.templateWorkspaceId ?? null,
    position: c.position,
    createdAt: c.createdAt,
  };
}

function toProjectWorkspace(w: ProjectWorkspaceRow): ProjectWorkspaceRecord {
  return {
    id: w.id,
    tenantId: w.tenantId,
    userId: w.userId,
    templateSlug: w.templateSlug,
    runtimeTier: w.runtimeTier,
    status: w.status,
    ideHost: w.ideHost ?? null,
    deployUrl: w.deployUrl ?? null,
    deployPort: w.deployPort ?? null,
    storageRef: w.storageRef ?? null,
    qualityScore: w.qualityScore ?? null,
    qualityReport: w.qualityReport ?? null,
    analyzedAt: w.analyzedAt ?? null,
    createdAt: w.createdAt,
    lastActivityAt: w.lastActivityAt,
  };
}

function toProjectFork(f: ProjectForkRow): ProjectForkRecord {
  return {
    id: f.id,
    tenantId: f.tenantId,
    projectId: f.projectId,
    componentId: f.componentId,
    userId: f.userId,
    workspaceId: f.workspaceId,
    sourceTemplateSlug: f.sourceTemplateSlug ?? null,
    sourceWorkspaceId: f.sourceWorkspaceId ?? null,
    createdAt: f.createdAt,
  };
}

function toProjectSubmission(s: ProjectSubmissionRow): ProjectSubmissionRecord {
  return {
    id: s.id,
    tenantId: s.tenantId,
    projectId: s.projectId,
    componentId: s.componentId,
    userId: s.userId,
    workspaceId: s.workspaceId,
    title: s.title,
    description: s.description,
    githubUrl: s.githubUrl ?? null,
    demoUrl: s.demoUrl ?? null,
    status: s.status,
    score: s.score ?? null,
    feedback: s.feedback ?? null,
    autoScore: s.autoScore ?? null,
    autoReport: s.autoReport ?? null,
    autoEvaluatedAt: s.autoEvaluatedAt ?? null,
    submittedAt: s.submittedAt,
    evaluatedAt: s.evaluatedAt ?? null,
  };
}

function toGitConnection(c: GitConnectionRow): GitConnectionRecord {
  return {
    id: c.id,
    tenantId: c.tenantId,
    userId: c.userId,
    provider: c.provider,
    login: c.login,
    tokenCiphertext: c.tokenCiphertext,
    scopes: c.scopes,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

function toQualityEvaluation(q: QualityEvaluationRow): QualityEvaluationRecord {
  return {
    id: q.id,
    tenantId: q.tenantId,
    userId: q.userId,
    projectId: q.projectId ?? null,
    componentId: q.componentId ?? null,
    workspaceId: q.workspaceId,
    score: q.score ?? null,
    issueCount: q.issueCount,
    report: q.report ?? null,
    status: q.status,
    error: q.error ?? null,
    createdAt: q.createdAt,
  };
}

function toGitPublish(p: GitPublishRow): GitPublishRecord {
  return {
    id: p.id,
    tenantId: p.tenantId,
    userId: p.userId,
    workspaceId: p.workspaceId,
    repoFullName: p.repoFullName,
    repoUrl: p.repoUrl,
    branch: p.branch,
    status: p.status,
    commitSha: p.commitSha ?? null,
    error: p.error ?? null,
    createdAt: p.createdAt,
  };
}

function toSupportIssue(s: SupportIssueRow): SupportIssueRecord {
  return {
    id: s.id,
    tenantId: s.tenantId,
    userId: s.userId ?? null,
    category: s.category,
    title: s.title,
    description: s.description,
    pageUrl: s.pageUrl ?? null,
    status: s.status,
    createdAt: s.createdAt,
  };
}

function toSkillPassport(s: SkillPassportRow): SkillPassportRecord {
  return {
    id: s.id,
    userId: s.userId,
    tenantId: s.tenantId,
    verifiedBadges: s.verifiedBadges,
    bestContestRank: s.bestContestRank ?? null,
    avgLabScore: s.avgLabScore ?? null,
    communicationScore: s.communicationScore ?? null,
    updatedAt: s.updatedAt,
  };
}

function toInterviewAttempt(a: InterviewAttemptRow): InterviewAttemptRecord {
  return {
    id: a.id,
    tenantId: a.tenantId,
    userId: a.userId,
    promptId: a.promptId,
    promptTitle: a.promptTitle,
    transcript: a.transcript,
    communicationScore: a.communicationScore,
    grammar: a.grammar,
    vocabulary: a.vocabulary,
    fillerWords: a.fillerWords,
    technicalAccuracy: a.technicalAccuracy,
    createdAt: a.createdAt,
  };
}

function toClarityAttempt(c: ClarityAttemptRow): ClarityAttemptRecord {
  return {
    id: c.id,
    tenantId: c.tenantId,
    userId: c.userId,
    taskId: c.taskId,
    taskTitle: c.taskTitle,
    skill: c.skill,
    response: c.response,
    score: c.score,
    band: c.band,
    grammar: c.grammar,
    vocabulary: c.vocabulary,
    content: c.content,
    fluency: c.fluency,
    createdAt: c.createdAt,
  };
}

function toMentorMessage(m: MentorMessageRow): MentorMessageRecord {
  return {
    id: m.id,
    tenantId: m.tenantId,
    userId: m.userId,
    role: m.role,
    content: m.content,
    topic: m.topic ?? null,
    createdAt: m.createdAt,
  };
}

function toBankQuestion(q: BankQuestionRow): BankQuestionRecord {
  return {
    id: q.id,
    tenantId: q.tenantId,
    createdBy: q.createdBy,
    kind: q.kind,
    prompt: q.prompt,
    options: q.options ?? null,
    correct: q.correct ?? null,
    maxScore: q.maxScore,
    tags: q.tags ?? null,
    createdAt: q.createdAt,
  };
}

function toSocialPost(p: SocialPostRow): SocialPostRecord {
  return {
    id: p.id,
    tenantId: p.tenantId,
    userId: p.userId,
    body: p.body,
    createdAt: p.createdAt,
  };
}

function toSocialFollow(f: SocialFollowRow): SocialFollowRecord {
  return {
    id: f.id,
    tenantId: f.tenantId,
    followerId: f.followerId,
    followeeId: f.followeeId,
    createdAt: f.createdAt,
  };
}

function toDepartment(d: DepartmentRow): DepartmentRecord {
  return {
    id: d.id,
    tenantId: d.tenantId,
    name: d.name,
    createdAt: d.createdAt,
  };
}

function toContest(c: ContestRow): ContestRecord {
  return {
    id: c.id,
    tenantId: c.tenantId,
    title: c.title,
    description: c.description,
    status: c.status,
    startAt: c.startAt ?? null,
    endAt: c.endAt ?? null,
    maxScore: c.maxScore,
    exerciseSlug: c.exerciseSlug ?? null,
    createdBy: c.createdBy,
    createdAt: c.createdAt,
  };
}

function toContestEntry(e: ContestEntryRow): ContestEntryRecord {
  return {
    id: e.id,
    contestId: e.contestId,
    tenantId: e.tenantId,
    userId: e.userId,
    score: e.score,
    durationMs: e.durationMs,
    submittedAt: e.submittedAt,
  };
}
