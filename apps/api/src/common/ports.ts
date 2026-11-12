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

export interface BatchRecord {
  id: string;
  tenantId: string;
  name: string;
  departmentId?: string | null;
  startDate?: Date | null;
  endDate?: Date | null;
}

export interface SnippetRecord {
  id: string;
  userId: string;
  language: string;
  title: string;
  source: string;
  stdin: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * A student's sitting of an assessment. `answers` and `results` are JSON blobs
 * (keyed by question id) rather than child rows: they are written once, read
 * whole, and never queried by field, so a relational split would buy nothing.
 */
export interface AttemptRecord {
  id: string;
  userId: string;
  assessmentId: string;
  /** in_progress | submitted | expired */
  status: string;
  startedAt: Date;
  /** Server-computed deadline; null for an untimed practice assessment. */
  endsAt: Date | null;
  submittedAt: Date | null;
  score: number | null;
  /** JSON: answer map keyed by question id. */
  answers: string | null;
  /** JSON: per-question results, for re-display after submission. */
  results: string | null;
}

/** A client-reported integrity signal. Aggregated, never treated as proof. */
export interface ProctorEventRecord {
  id: string;
  attemptId: string;
  type: string;
  payload: string | null;
  createdAt: Date;
}

export interface EnrollmentRecord {
  id: string;
  userId: string;
  courseId: string;
  batchId?: string | null;
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
  /** Resolve a lesson from its lab exercise slug (gradebook webhook routing). */
  findByExerciseSlug?(exerciseSlug: string): Promise<LessonRecord | null>;
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
  /** All progress rows for a set of users; backs the instructor gradebook. */
  listByUsers(userIds: string[]): Promise<LessonProgressRecord[]>;
}

export interface BatchRepository {
  create(input: {
    tenantId: string;
    name: string;
    departmentId?: string | null;
    startDate?: Date | null;
    endDate?: Date | null;
  }): Promise<BatchRecord>;
  findById(id: string): Promise<BatchRecord | null>;
  listByTenant(tenantId: string): Promise<BatchRecord[]>;
}

export interface SnippetRepository {
  create(input: {
    userId: string;
    language: string;
    title: string;
    source: string;
    stdin: string;
  }): Promise<SnippetRecord>;
  update(
    id: string,
    userId: string,
    patch: Partial<Pick<SnippetRecord, 'title' | 'language' | 'source' | 'stdin'>>,
  ): Promise<SnippetRecord | null>;
  /** A user's own snippets, newest first. */
  listByUser(userId: string): Promise<SnippetRecord[]>;
  /** Scoped by userId so one user can never read or delete another's snippet. */
  findById(id: string, userId: string): Promise<SnippetRecord | null>;
  delete(id: string, userId: string): Promise<boolean>;
}

export interface EnrollmentRepository {
  /**
   * Enrol a user on a course within a batch. Idempotent: a repeat for the same
   * (user, course) pair returns the existing row rather than failing on the
   * unique constraint, so a re-run of an assignment is safe.
   */
  assign(input: {
    userId: string;
    courseId: string;
    batchId?: string | null;
  }): Promise<EnrollmentRecord>;
  listByBatch(batchId: string): Promise<EnrollmentRecord[]>;
}

export interface AttemptRepository {
  create(input: {
    userId: string;
    assessmentId: string;
    startedAt: Date;
    endsAt: Date | null;
  }): Promise<AttemptRecord>;
  findById(id: string): Promise<AttemptRecord | null>;
  /** An in-progress attempt for this user and assessment, if one is open. */
  findOpen(userId: string, assessmentId: string): Promise<AttemptRecord | null>;
  /** Every attempt by a user, newest first (their history). */
  listByUser(userId: string): Promise<AttemptRecord[]>;
  update(id: string, patch: Partial<AttemptRecord>): Promise<AttemptRecord>;
}

export interface ProctorEventRepository {
  record(input: { attemptId: string; type: string; payload?: string | null }): Promise<ProctorEventRecord>;
  /** All events for one attempt, oldest first. */
  listByAttempt(attemptId: string): Promise<ProctorEventRecord[]>;
  /** Every event across a set of attempts, for the instructor integrity view. */
  listByAttempts(attemptIds: string[]): Promise<ProctorEventRecord[]>;
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
