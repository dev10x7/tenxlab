/**
 * Repository ports. Business logic depends on these interfaces, not on Prisma
 * or NestJS, so it can be unit-tested with in-memory implementations and the
 * runtime can swap in a Prisma-backed adapter.
 */

export interface TenantRecord {
  id: string;
  name: string;
  domain: string;
  maxConcurrentLabs: number;
  plan: string;
  status: string;
}

export interface UserRecord {
  id: string;
  email: string;
  fullName: string;
}

export interface MembershipRecord {
  id: string;
  userId: string;
  tenantId: string;
  role: string;
  status: string;
}

export interface LessonRecord {
  id: string;
  moduleId: string;
  title: string;
  type: string;
  labProvider?: string | null;
  exerciseSlug?: string | null;
  runtimeTier?: string | null;
  maxScore: number;
}

export interface LabSessionRecord {
  id: string;
  tenantId: string;
  userId: string;
  exerciseSlug: string;
  tier: string;
  status: string;
  ideUrl?: string | null;
  kubelabRef?: string | null;
  startedAt: Date;
  lastActivityAt: Date;
  ttlSeconds: number;
}

export interface LessonProgressRecord {
  id: string;
  userId: string;
  lessonId: string;
  status: string;
  score?: number | null;
  attempts: number;
  completedAt?: Date | null;
}

export interface TenantRepository {
  findById(id: string): Promise<TenantRecord | null>;
  findByDomain(domain: string): Promise<TenantRecord | null>;
}

export interface UserRepository {
  findByEmail(email: string): Promise<UserRecord | null>;
  upsertByEmail(email: string, fullName: string): Promise<UserRecord>;
  findById(id: string): Promise<UserRecord | null>;
}

export interface MembershipRepository {
  find(userId: string, tenantId: string): Promise<MembershipRecord | null>;
  listByTenant(tenantId: string): Promise<MembershipRecord[]>;
  create(
    userId: string,
    tenantId: string,
    role: string,
  ): Promise<MembershipRecord>;
}

export interface LessonRepository {
  findById(id: string): Promise<LessonRecord | null>;
}

export interface LabSessionRepository {
  create(input: Omit<LabSessionRecord, 'id'>): Promise<LabSessionRecord>;
  findById(id: string): Promise<LabSessionRecord | null>;
  countActiveByTenant(tenantId: string): Promise<number>;
  update(
    id: string,
    patch: Partial<LabSessionRecord>,
  ): Promise<LabSessionRecord>;
}

export interface ProgressRepository {
  findByUserAndLesson(
    userId: string,
    lessonId: string,
  ): Promise<LessonProgressRecord | null>;
  upsert(
    userId: string,
    lessonId: string,
    patch: Partial<LessonProgressRecord>,
  ): Promise<LessonProgressRecord>;
}

/** Idempotency ledger for inbound events (webhooks). */
export interface EventLedger {
  /** Returns true if the event was newly recorded, false if already seen. */
  recordIfNew(eventId: string, source: string): Promise<boolean>;
}

/** Replay protection for partner SSO tokens. */
export interface ReplayGuard {
  /** Returns true if the jti is new; false if it was already used. */
  claim(jti: string, partnerId: string): Promise<boolean>;
}
