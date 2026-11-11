import { PrismaClient } from '@prisma/client';
import type {
  EventLedger,
  LabSessionRecord,
  LabSessionRepository,
  LessonProgressRecord,
  LessonRecord,
  LessonRepository,
  MembershipRecord,
  MembershipRepository,
  ProgressRepository,
  ReplayGuard,
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

function toTenant(t: TenantRow): TenantRecord {
  return {
    id: t.id,
    name: t.name,
    domain: t.domain,
    maxConcurrentLabs: t.maxConcurrentLabs,
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
