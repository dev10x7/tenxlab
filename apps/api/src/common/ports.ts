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
  update(id: string, patch: Partial<ProjectWorkspaceRecord>): Promise<ProjectWorkspaceRecord>;
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
