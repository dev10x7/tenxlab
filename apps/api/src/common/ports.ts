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
  /** Monthly spend ceiling in USD cents. 0 means unlimited. */
  monthlyBudgetCents: number;
  /** Fork storage ceiling in gibibytes. 0 or absent means unlimited. */
  maxStorageGb?: number;
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
  /** Display order within the module; authored lessons are reorderable. */
  position?: number;
  /** Progressive hint for a practice lab, revealed on request. */
  hint?: string | null;
  /** Reading/video lesson text shown in the viewer (plain text). */
  body?: string | null;
  /** Quiz lessons only: the assessment the viewer links to. */
  assessmentId?: string | null;
}

export interface CourseRecord {
  id: string;
  tenantId: string;
  /** URL-safe unique key within the tenant; the catalog addresses by slug. */
  slug: string;
  title: string;
  description: string;
  /** draft | published. Only published courses are visible to students. */
  status: string;
  createdAt: Date;
}

export interface ModuleRecord {
  id: string;
  courseId: string;
  title: string;
  position: number;
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

/**
 * One scheduled class meeting of a batch. Attendance is recorded per student per
 * session, so "overall" attendance is the aggregate and "session-level" is the
 * per-meeting breakdown (ByteXL parity §2.9).
 */
export interface ClassSessionRecord {
  id: string;
  batchId: string;
  title: string;
  scheduledAt: Date;
  createdAt: Date;
}

export interface AttendanceRecord {
  id: string;
  sessionId: string;
  userId: string;
  /** present | absent | late | excused */
  status: string;
  markedBy?: string | null;
  markedAt: Date;
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

// ---------------------------------------------------------------- Projects

export interface ProjectRecord {
  id: string;
  tenantId: string;
  title: string;
  description: string;
  runtimeTier: string;
  status: string;
  deadline: Date | null;
  maxScore: number;
  createdAt: Date;
}

/** One technology slot in a project; a fork copies its template. */
export interface ProjectComponentRecord {
  id: string;
  tenantId: string;
  projectId: string;
  title: string;
  technology: string;
  templateSlug: string | null;
  templateWorkspaceId: string | null;
  position: number;
  createdAt: Date;
}

export interface ProjectWorkspaceRecord {
  id: string;
  tenantId: string;
  userId: string;
  templateSlug: string;
  runtimeTier: string;
  status: string;
  ideUrl: string | null;
  /** Public URL the workspace's service is exposed on after a Deploy (E5). */
  deployUrl: string | null;
  /** Container port the deploy exposes. */
  deployPort: number | null;
  storageRef: string | null;
  /** Latest auto-evaluation score (0-100), or null if never analysed. */
  qualityScore: number | null;
  /** Latest auto-evaluation report, JSON-encoded (`QualityReport`). */
  qualityReport: string | null;
  /** When the latest auto-evaluation ran. */
  analyzedAt: Date | null;
  createdAt: Date;
  lastActivityAt: Date;
}

export interface ProjectForkRecord {
  id: string;
  tenantId: string;
  projectId: string;
  componentId: string;
  userId: string;
  workspaceId: string;
  sourceTemplateSlug: string | null;
  sourceWorkspaceId: string | null;
  createdAt: Date;
}

export interface ProjectSubmissionRecord {
  id: string;
  tenantId: string;
  projectId: string;
  componentId: string;
  userId: string;
  workspaceId: string;
  title: string;
  description: string;
  githubUrl: string | null;
  demoUrl: string | null;
  status: string;
  score: number | null;
  feedback: string | null;
  /** Auto-evaluation score (0-100) copied from the workspace at submit time. */
  autoScore: number | null;
  /** Auto-evaluation report, JSON-encoded (`QualityReport`). */
  autoReport: string | null;
  /** When the auto-evaluation ran. */
  autoEvaluatedAt: Date | null;
  submittedAt: Date;
  evaluatedAt: Date | null;
}

/**
 * A student's connected GitHub account (git publish, ByteXL's Source Control
 * push). The access token is stored encrypted; only the login is readable.
 */
export interface GitConnectionRecord {
  id: string;
  tenantId: string;
  userId: string;
  provider: string;
  /** GitHub login the token belongs to, e.g. `octocat`. */
  login: string;
  /** AES-GCM ciphertext of the access token. Never the raw token. */
  tokenCiphertext: string;
  scopes: string;
  createdAt: Date;
  updatedAt: Date;
}

/** One publish of a workspace to a student's GitHub repository. */
export interface GitPublishRecord {
  id: string;
  tenantId: string;
  userId: string;
  workspaceId: string;
  /** `owner/repo` the code was pushed to. */
  repoFullName: string;
  repoUrl: string;
  branch: string;
  status: string;
  commitSha: string | null;
  error: string | null;
  createdAt: Date;
}

/** A user-submitted support issue (ByteXL's "Report an Issue" form). */
export interface SupportIssueRecord {
  id: string;
  tenantId: string;
  /** The reporting user; null when an anonymous/partner report is accepted. */
  userId: string | null;
  /** bug | feature | question | other */
  category: string;
  title: string;
  description: string;
  /** The page the reporter was on, so support can reproduce. */
  pageUrl: string | null;
  /** open | in_progress | resolved */
  status: string;
  createdAt: Date;
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
  /** Create an authored lesson. */
  create?(input: Omit<LessonRecord, 'id'>): Promise<LessonRecord>;
  update?(id: string, patch: Partial<LessonRecord>): Promise<LessonRecord>;
  delete?(id: string): Promise<void>;
  /** A module's lessons in display order. */
  listByModule?(moduleId: string): Promise<LessonRecord[]>;
}

export interface CourseRepository {
  create(input: Omit<CourseRecord, 'id' | 'createdAt'>): Promise<CourseRecord>;
  findById(id: string): Promise<CourseRecord | null>;
  findBySlug(tenantId: string, slug: string): Promise<CourseRecord | null>;
  /** A tenant's courses, newest first. */
  listByTenant(tenantId: string): Promise<CourseRecord[]>;
  update(id: string, patch: Partial<CourseRecord>): Promise<CourseRecord>;
  delete(id: string): Promise<void>;
}

export interface ModuleRepository {
  create(input: Omit<ModuleRecord, 'id'>): Promise<ModuleRecord>;
  findById(id: string): Promise<ModuleRecord | null>;
  /** A course's modules in display order. */
  listByCourse(courseId: string): Promise<ModuleRecord[]>;
  update(id: string, patch: Partial<ModuleRecord>): Promise<ModuleRecord>;
  delete(id: string): Promise<void>;
}

export interface LabSessionRepository {
  create(input: Omit<LabSessionRecord, 'id'>): Promise<LabSessionRecord>;
  findById(id: string): Promise<LabSessionRecord | null>;
  countActiveByTenant(tenantId: string): Promise<number>;
  /** All sessions for a tenant, oldest first; backs cost roll-ups. */
  listByTenant(tenantId: string): Promise<LabSessionRecord[]>;
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
  /** A user's own enrolments; backs the student dashboard's roadmaps. */
  listByUser(userId: string): Promise<EnrollmentRecord[]>;
}

export interface ClassSessionRepository {
  create(input: {
    batchId: string;
    title: string;
    scheduledAt: Date;
  }): Promise<ClassSessionRecord>;
  findById(id: string): Promise<ClassSessionRecord | null>;
  /** A batch's sessions, oldest first (the schedule order). */
  listByBatch(batchId: string): Promise<ClassSessionRecord[]>;
}

export interface AttendanceRepository {
  /**
   * Record or correct a student's attendance for a session. Idempotent on the
   * (session, user) key so a re-mark updates rather than duplicates.
   */
  mark(input: {
    sessionId: string;
    userId: string;
    status: string;
    markedBy?: string | null;
  }): Promise<AttendanceRecord>;
  listBySession(sessionId: string): Promise<AttendanceRecord[]>;
  /** All attendance rows for a set of sessions; backs the batch/student views. */
  listBySessions(sessionIds: string[]): Promise<AttendanceRecord[]>;
  /** All attendance rows for a user; backs the student's overall view. */
  listByUser(userId: string): Promise<AttendanceRecord[]>;
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

// ---------------------------------------------------------------- Projects

export interface ProjectRepository {
  create(input: Omit<ProjectRecord, 'id' | 'createdAt'>): Promise<ProjectRecord>;
  findById(id: string): Promise<ProjectRecord | null>;
  /** Every project in a tenant, newest first. */
  listByTenant(tenantId: string): Promise<ProjectRecord[]>;
  update(id: string, patch: Partial<ProjectRecord>): Promise<ProjectRecord>;
}

export interface ProjectComponentRepository {
  create(
    input: Omit<ProjectComponentRecord, 'id' | 'createdAt'>,
  ): Promise<ProjectComponentRecord>;
  findById(id: string): Promise<ProjectComponentRecord | null>;
  /** A project's components in display order. */
  listByProject(projectId: string): Promise<ProjectComponentRecord[]>;
}

export interface ProjectWorkspaceRepository {
  create(
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
  ): Promise<ProjectWorkspaceRecord>;
  findById(id: string): Promise<ProjectWorkspaceRecord | null>;
  /** A user's workspaces within a tenant, newest first. */
  listByUser(tenantId: string, userId: string): Promise<ProjectWorkspaceRecord[]>;
  /** How many workspaces a tenant holds, for the storage-quota gate (ADR-20). */
  countByTenant(tenantId: string): Promise<number>;
  update(id: string, patch: Partial<ProjectWorkspaceRecord>): Promise<ProjectWorkspaceRecord>;
  /** Permanently remove a workspace row (Delete quick action, Nov'25 §1.5). */
  delete(id: string): Promise<void>;
}

export interface ProjectForkRepository {
  create(input: Omit<ProjectForkRecord, 'id' | 'createdAt'>): Promise<ProjectForkRecord>;
  findById(id: string): Promise<ProjectForkRecord | null>;
  /** A user's fork of one component (at most one). */
  findByComponentAndUser(
    componentId: string,
    userId: string,
  ): Promise<ProjectForkRecord | null>;
  /** A user's forks across a project's components. */
  listByProjectAndUser(
    projectId: string,
    userId: string,
  ): Promise<ProjectForkRecord[]>;
  /** Every fork of a project, for the instructor roster. */
  listByProject(projectId: string): Promise<ProjectForkRecord[]>;
  /** The fork that owns a workspace (at most one), for delete/cleanup. */
  findByWorkspaceId(workspaceId: string): Promise<ProjectForkRecord | null>;
  /** Remove a fork row when its workspace is deleted (Delete quick action). */
  delete(id: string): Promise<void>;
}

export interface ProjectSubmissionRepository {
  create(
    input: Omit<
      ProjectSubmissionRecord,
      'id' | 'submittedAt' | 'evaluatedAt' | 'autoScore' | 'autoReport' | 'autoEvaluatedAt'
    > & {
      autoScore?: number | null;
      autoReport?: string | null;
      autoEvaluatedAt?: Date | null;
    },
  ): Promise<ProjectSubmissionRecord>;
  findById(id: string): Promise<ProjectSubmissionRecord | null>;
  /** Submissions for one project in a tenant, newest first (instructor view). */
  listByProject(tenantId: string, projectId: string): Promise<ProjectSubmissionRecord[]>;
  /** A user's own submissions in a tenant, newest first (student view). */
  listByUser(tenantId: string, userId: string): Promise<ProjectSubmissionRecord[]>;
  update(id: string, patch: Partial<ProjectSubmissionRecord>): Promise<ProjectSubmissionRecord>;
}

/**
 * One auto-evaluation of a workspace (the SonarQube-equivalent run, ADR-13).
 * A row is written on success and on failure, so a trainer can always see that
 * the analyser ran and why it produced no score.
 */
export interface QualityEvaluationRecord {
  id: string;
  tenantId: string;
  userId: string;
  projectId: string | null;
  componentId: string | null;
  workspaceId: string;
  /** 0-100 quality score, or null when the run failed. */
  score: number | null;
  /** Number of issues the analyser raised. */
  issueCount: number;
  /** Full report, JSON-encoded (`QualityReport`). */
  report: string | null;
  status: string; // succeeded | failed
  error: string | null;
  createdAt: Date;
}

export interface QualityEvaluationRepository {
  create(
    input: Omit<QualityEvaluationRecord, 'id' | 'createdAt'>,
  ): Promise<QualityEvaluationRecord>;
  /** A workspace's evaluation history, newest first. */
  listByWorkspace(workspaceId: string): Promise<QualityEvaluationRecord[]>;
  /** The most recent evaluation of a workspace, if any. */
  latestByWorkspace(workspaceId: string): Promise<QualityEvaluationRecord | null>;
}

export interface GitConnectionRepository {
  /** A user's connection for one provider (at most one per provider). */
  findByUser(userId: string, provider: string): Promise<GitConnectionRecord | null>;
  /** Upsert on (userId, provider): reconnecting replaces the stored token. */
  upsert(
    input: Omit<GitConnectionRecord, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<GitConnectionRecord>;
  delete(userId: string, provider: string): Promise<boolean>;
}

export interface GitPublishRepository {
  create(input: Omit<GitPublishRecord, 'id' | 'createdAt'>): Promise<GitPublishRecord>;
  /** A workspace's publish history, newest first. */
  listByWorkspace(workspaceId: string): Promise<GitPublishRecord[]>;
  /** The most recent successful publish of a workspace, if any. */
  latestByWorkspace(workspaceId: string): Promise<GitPublishRecord | null>;
}

export interface SupportIssueRepository {
  create(input: Omit<SupportIssueRecord, 'id' | 'createdAt'>): Promise<SupportIssueRecord>;
  findById(id: string): Promise<SupportIssueRecord | null>;
  /** A tenant's issues, newest first (the support queue). */
  listByTenant(tenantId: string): Promise<SupportIssueRecord[]>;
  update(id: string, patch: Partial<SupportIssueRecord>): Promise<SupportIssueRecord>;
}

// ---------------------------------------------------------------- P3: Hiring

/**
 * The indexed Skill Passport (ByteXL parity §2.8). One row per (user, tenant)
 * aggregates the evidence a recruiter reads: verified badges, the student's best
 * contest rank, their average lab score, and their AI communication score. It is
 * a *derived* cache — rebuilt from the primary tables by `PassportService`, never
 * authored directly — so the recruiter portal can filter without joining.
 */
export interface SkillPassportRecord {
  id: string;
  userId: string;
  tenantId: string;
  verifiedBadges: number;
  bestContestRank: number | null;
  avgLabScore: number | null;
  communicationScore: number | null;
  updatedAt: Date;
}

export interface SkillPassportRepository {
  /** The passport for a user in a tenant, or null when never built. */
  find(userId: string, tenantId: string): Promise<SkillPassportRecord | null>;
  /** Upsert on (user, tenant): a rebuild replaces the cached aggregates. */
  upsert(
    input: Omit<SkillPassportRecord, 'id' | 'updatedAt'>,
  ): Promise<SkillPassportRecord>;
  /** A tenant's passports, for the recruiter filter (unfiltered). */
  listByTenant(tenantId: string): Promise<SkillPassportRecord[]>;
}

/**
 * One AI mock-interview sitting. The transcript is scored by the AI plane's
 * `speech.py` (grammar / vocabulary / filler / technical), and the overall
 * communication score is written back onto the student's Skill Passport.
 */
export interface InterviewAttemptRecord {
  id: string;
  tenantId: string;
  userId: string;
  /** The prompt the student answered (a role/topic, e.g. "Explain Kubernetes"). */
  promptId: string;
  promptTitle: string;
  transcript: string;
  communicationScore: number;
  grammar: number;
  vocabulary: number;
  fillerWords: number;
  technicalAccuracy: number;
  createdAt: Date;
}

export interface InterviewAttemptRepository {
  create(
    input: Omit<InterviewAttemptRecord, 'id' | 'createdAt'>,
  ): Promise<InterviewAttemptRecord>;
  /** A user's own sittings, newest first. */
  listByUser(userId: string): Promise<InterviewAttemptRecord[]>;
  /** The most recent sitting of a user, if any. */
  latestByUser(userId: string): Promise<InterviewAttemptRecord | null>;
}

// ---------------------------------------------------------------- P3: AI Mentor

/**
 * One turn in an AI Mentor conversation. The mentor answers from a fixed,
 * deterministic knowledge base (no LLM), so the log is small and replayable.
 */
export interface MentorMessageRecord {
  id: string;
  tenantId: string;
  userId: string;
  /** `user` or `mentor`. */
  role: string;
  content: string;
  /** The topic the mentor keyed off, when the turn is a mentor answer. */
  topic: string | null;
  createdAt: Date;
}

export interface MentorMessageRepository {
  create(
    input: Omit<MentorMessageRecord, 'id' | 'createdAt'>,
  ): Promise<MentorMessageRecord>;
  /** A user's conversation, oldest first. */
  listByUser(userId: string): Promise<MentorMessageRecord[]>;
  /** Clear a user's conversation. */
  clearByUser(userId: string): Promise<void>;
}

// ---------------------------------------------------------------- P3: Question bank

/**
 * A reusable question in the tenant's bank. It mirrors the fields an assessment
 * question carries, so an author can copy a bank question into a test without
 * re-typing it. Kept tenant-scoped and independent of any one assessment.
 */
export interface BankQuestionRecord {
  id: string;
  tenantId: string;
  createdBy: string;
  /** coding | mcq | fill | descriptive */
  kind: string;
  prompt: string;
  /** JSON array of options (choice questions only). */
  options: string | null;
  /** JSON: correct answer / index (choice questions only). */
  correct: string | null;
  maxScore: number;
  /** Free-form tags for filtering, JSON array of strings. */
  tags: string | null;
  createdAt: Date;
}

export interface BankQuestionRepository {
  create(
    input: Omit<BankQuestionRecord, 'id' | 'createdAt'>,
  ): Promise<BankQuestionRecord>;
  findById(id: string): Promise<BankQuestionRecord | null>;
  /** A tenant's questions, newest first. */
  listByTenant(tenantId: string): Promise<BankQuestionRecord[]>;
  update(id: string, patch: Partial<BankQuestionRecord>): Promise<BankQuestionRecord>;
  delete(id: string): Promise<void>;
}

// ---------------------------------------------------------------- P3: Social

/** A short update a student posts to their batch's activity feed. */
export interface SocialPostRecord {
  id: string;
  tenantId: string;
  userId: string;
  body: string;
  createdAt: Date;
}

export interface SocialPostRepository {
  create(input: Omit<SocialPostRecord, 'id' | 'createdAt'>): Promise<SocialPostRecord>;
  findById(id: string): Promise<SocialPostRecord | null>;
  /** A tenant's posts, newest first. */
  listByTenant(tenantId: string): Promise<SocialPostRecord[]>;
  /** Posts by a set of users, newest first (the "following" filter). */
  listByUsers(tenantId: string, userIds: string[]): Promise<SocialPostRecord[]>;
  delete(id: string): Promise<void>;
}

/** A one-way follow edge: `followerId` follows `followeeId`. */
export interface SocialFollowRecord {
  id: string;
  tenantId: string;
  followerId: string;
  followeeId: string;
  createdAt: Date;
}

export interface SocialFollowRepository {
  /** Idempotent: following twice returns the existing edge. */
  follow(
    input: Omit<SocialFollowRecord, 'id' | 'createdAt'>,
  ): Promise<SocialFollowRecord>;
  unfollow(followerId: string, followeeId: string): Promise<boolean>;
  /** The users this follower follows, newest first. */
  listFollowing(tenantId: string, followerId: string): Promise<SocialFollowRecord[]>;
  /** The users following this account, newest first. */
  listFollowers(tenantId: string, followeeId: string): Promise<SocialFollowRecord[]>;
}

// ---------------------------------------------------------------- P3: Organizations

/** A department within a tenant; batches group under one. */
export interface DepartmentRecord {
  id: string;
  tenantId: string;
  name: string;
  createdAt: Date;
}

export interface DepartmentRepository {
  create(input: Omit<DepartmentRecord, 'id' | 'createdAt'>): Promise<DepartmentRecord>;
  findById(id: string): Promise<DepartmentRecord | null>;
  /** A tenant's departments, alphabetical. */
  listByTenant(tenantId: string): Promise<DepartmentRecord[]>;
  delete(id: string): Promise<void>;
}

// ---------------------------------------------------------------- Phase G: Contests

/**
 * A timed contest (ByteXL parity §2.8). `status` is the authoring lifecycle
 * (draft/published); the *phase* a student sees (scheduled/live/ended) is
 * derived from the window on read, so a contest cannot be left open past its
 * end time by a missed job.
 */
export interface ContestRecord {
  id: string;
  tenantId: string;
  title: string;
  description: string;
  status: string;
  startAt: Date | null;
  endAt: Date | null;
  maxScore: number;
  /**
   * Optional exercise scope: a completion of this lab slug credits the contest.
   * Null means "open" — any lab completion in the tenant during the window
   * credits it.
   */
  exerciseSlug: string | null;
  createdBy: string;
  createdAt: Date;
}

export interface ContestRepository {
  create(input: Omit<ContestRecord, 'id' | 'createdAt'>): Promise<ContestRecord>;
  findById(id: string): Promise<ContestRecord | null>;
  /** A tenant's contests, newest first. */
  listByTenant(tenantId: string): Promise<ContestRecord[]>;
  update(id: string, patch: Partial<ContestRecord>): Promise<ContestRecord>;
  delete(id: string): Promise<void>;
}

/**
 * One student's standing in a contest: their best score and the time it took.
 * The durable source of truth for a leaderboard; the ranking index is rebuilt
 * from these rows if it is ever lost.
 */
export interface ContestEntryRecord {
  id: string;
  contestId: string;
  tenantId: string;
  userId: string;
  score: number;
  durationMs: number;
  submittedAt: Date;
}

export interface ContestEntryRepository {
  /**
   * Record a student's entry, keeping only their best (highest score, then
   * fastest). Idempotent per (contest, user): a worse re-submission is ignored.
   */
  upsertBest(
    input: Omit<ContestEntryRecord, 'id' | 'submittedAt'> & { submittedAt: Date },
  ): Promise<ContestEntryRecord>;
  /** Every entry in a contest; the service ranks these for the fallback path. */
  listByContest(contestId: string): Promise<ContestEntryRecord[]>;
  /** One student's best entry in a contest, or null. */
  find(contestId: string, userId: string): Promise<ContestEntryRecord | null>;
  /** A user's best entries across contests; backs the passport's contest rank. */
  listByUser(userId: string): Promise<ContestEntryRecord[]>;
}
