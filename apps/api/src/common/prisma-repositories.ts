import { PrismaClient } from '@prisma/client';
import type {
  AttemptRecord,
  AttemptRepository,
  BatchRecord,
  BatchRepository,
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
  ReplayGuard,
  SnippetRecord,
  SnippetRepository,
  TenantRecord,
  TenantRepository,
  UserRecord,
  UserRepository,
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
    if (!l) return null;
    return {
      id: l.id,
      moduleId: l.moduleId,
      title: l.title,
      type: l.type,
      labProvider: l.labProvider ?? null,
      exerciseSlug: l.exerciseSlug ?? null,
      runtimeTier: l.runtimeTier ?? null,
      maxScore: l.maxScore,
    };
  }
  async findByExerciseSlug(exerciseSlug: string): Promise<LessonRecord | null> {
    const l = await this.db.lesson.findFirst({ where: { exerciseSlug } });
    if (!l) return null;
    return {
      id: l.id,
      moduleId: l.moduleId,
      title: l.title,
      type: l.type,
      labProvider: l.labProvider ?? null,
      exerciseSlug: l.exerciseSlug ?? null,
      runtimeTier: l.runtimeTier ?? null,
      maxScore: l.maxScore,
    };
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
        ideUrl: input.ideUrl ?? null,
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
        ideUrl: patch.ideUrl === undefined ? undefined : patch.ideUrl,
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
      'id' | 'createdAt' | 'lastActivityAt' | 'deployUrl' | 'deployPort'
    > & { deployUrl?: string | null; deployPort?: number | null },
  ): Promise<ProjectWorkspaceRecord> {
    const w = await this.db.projectWorkspace.create({ data: input });
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
  async update(
    id: string,
    patch: Partial<ProjectWorkspaceRecord>,
  ): Promise<ProjectWorkspaceRecord> {
    const w = await this.db.projectWorkspace.update({ where: { id }, data: patch });
    return toProjectWorkspace(w);
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
}

export class PrismaProjectSubmissionRepository
  implements ProjectSubmissionRepository
{
  constructor(private readonly db: PrismaClient) {}
  async create(
    input: Omit<ProjectSubmissionRecord, 'id' | 'submittedAt' | 'evaluatedAt'>,
  ): Promise<ProjectSubmissionRecord> {
    const s = await this.db.projectSubmission.create({ data: input });
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

function toTenant(t: TenantRow): TenantRecord {
  return {
    id: t.id,
    name: t.name,
    domain: t.domain,
    maxConcurrentLabs: t.maxConcurrentLabs,
    monthlyBudgetCents: t.monthlyBudgetCents,
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
    ideUrl: s.ideUrl ?? null,
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
    ideUrl: w.ideUrl ?? null,
    deployUrl: w.deployUrl ?? null,
    deployPort: w.deployPort ?? null,
    storageRef: w.storageRef ?? null,
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
