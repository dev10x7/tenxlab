/**
 * Thin typed client for the TenXLab API. Browser-side calls go through the
 * Next.js rewrite proxy (/api/*) so the session cookie stays same-origin.
 */

export interface Session {
  userId: string;
  tenantId: string;
  role: 'student' | 'instructor' | 'admin';
  displayName: string;
}

export interface LessonSummary {
  id: string;
  title: string;
  kind: 'video' | 'reading' | 'lab' | 'quiz';
  status: 'not_started' | 'in_progress' | 'complete';
  score?: number | null;
  hint?: string;
  /** Lab lessons only: false when the lesson has no exercise to launch. */
  launchable?: boolean;
}

export interface CourseSummary {
  id: string;
  slug: string;
  title: string;
  description: string;
  lessons: LessonSummary[];
}

/** A single lesson opened in the viewer. */
export interface LessonDetail {
  id: string;
  title: string;
  kind: 'video' | 'reading' | 'lab' | 'quiz';
  status: 'not_started' | 'in_progress' | 'complete';
  score?: number | null;
  hint?: string;
  body?: string;
  assessmentId?: string;
  /** Lab lessons only: false when the lesson has no exercise to launch. */
  launchable?: boolean;
  courseSlug: string;
  courseTitle: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers ?? {}),
    },
    credentials: 'include',
  });
  if (!res.ok) {
    throw new ApiError(res.status, `Request to ${path} failed (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface LabSession {
  sessionId: string;
  status: 'WARM' | 'ACTIVE' | 'IDLE' | 'TERMINATED' | 'FAILED';
  tier: string;
  ideUrl: string | null;
}

export interface BatchSummary {
  id: string;
  name: string;
  startDate: string | null;
  endDate: string | null;
  studentCount: number;
}

export interface RosterEntry {
  userId: string;
  fullName: string;
  email: string;
}

export interface GradebookCell {
  lessonId: string;
  title: string;
  status: string;
  score: number | null;
}

export interface GradebookRow {
  userId: string;
  fullName: string;
  email: string;
  completed: number;
  total: number;
  averageScore: number | null;
  cells: GradebookCell[];
}

export interface Gradebook {
  batchId: string;
  batchName: string;
  lessons: Array<{ id: string; title: string }>;
  rows: GradebookRow[];
}

export interface EditorLanguage {
  id: string;
  label: string;
  pistonRuntime: string;
  cmLanguage: string;
  extension: string;
  template: string;
  stdinHint: string;
}

export interface CodeRunResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  executionTimeMs: number;
  timedOut: boolean;
  unsupported: boolean;
}

export interface Snippet {
  id: string;
  userId: string;
  language: string;
  title: string;
  source: string;
  stdin: string;
  createdAt: string;
  updatedAt: string;
}

/** Tutor modes: `assist` may return corrected code; `socratic` never does. */
export type TutorMode = 'assist' | 'socratic';

/** An AI tutor review of the editor buffer (parity §1.6). */
export interface TutorReview {
  mode: TutorMode;
  score: number;
  issueCount: number;
  issues: { code: string; message: string; line: number | null }[];
  explanation: string;
  correctedCode: string | null;
  followUpQuestion: string | null;
}

export type QuestionKind = 'coding' | 'mcq' | 'fill' | 'descriptive';

export interface AssessmentQuestion {
  id: string;
  kind: QuestionKind;
  prompt: string;
  maxScore: number;
  stubCode?: string;
  hasSolutionRegion: boolean;
  options?: string[];
  multiple?: boolean;
}

export interface AssessmentView {
  id: string;
  courseSlug: string;
  title: string;
  mode: 'practice' | 'graded';
  proctored: boolean;
  durationSeconds: number | null;
  maxScore: number;
  /** True when a passcode must be supplied before a fresh attempt starts. */
  requiresPasscode: boolean;
  questions: AssessmentQuestion[];
}

export interface AttemptView {
  id: string;
  assessmentId: string;
  status: 'in_progress' | 'submitted' | 'expired';
  startedAt: string;
  endsAt: string | null;
  remainingSeconds: number | null;
  assessment: AssessmentView;
}

export interface QuestionResult {
  questionId: string;
  score: number;
  maxScore: number;
  correct: boolean;
  feedback: string;
}

export interface AttemptResult {
  attemptId: string;
  status: 'in_progress' | 'submitted' | 'expired';
  score: number;
  maxScore: number;
  results: QuestionResult[];
}

export type ProctorEventType =
  | 'focus_lost'
  | 'focus_gained'
  | 'copy'
  | 'paste'
  | 'fullscreen_exit'
  | 'display_count'
  | 'vm_detected'
  | 'network_lost';

export type SupportCategory = 'bug' | 'feature' | 'question' | 'other';
export type SupportStatus = 'open' | 'in_progress' | 'resolved';

/** A user-filed support issue, as returned by the Report-an-Issue surface. */
export interface SupportIssue {
  id: string;
  category: SupportCategory;
  title: string;
  description: string;
  pageUrl: string | null;
  status: SupportStatus;
  createdAt: string;
}

export interface ProctorSummary {
  attemptId: string;
  eventCount: number;
  riskScore: number;
  riskLevel: 'low' | 'medium' | 'high';
  counts: Record<string, number>;
}

export interface ProctoredAttemptRow {
  attemptId: string;
  assessmentId: string;
  status: string;
  score: number | null;
  startedAt: string;
  risk: ProctorSummary;
}

export type ProjectTemplateKind = 'framework' | 'base_image';

export type ProjectTemplateCategory =
  | 'front_end'
  | 'back_end'
  | 'full_stack'
  | 'database'
  | 'other';

export interface ProjectTemplate {
  id: string;
  slug: string;
  title: string;
  description: string;
  kind: ProjectTemplateKind;
  stack: string;
  image: string;
  category: ProjectTemplateCategory;
  database?: string;
}

export type ProjectStatus = 'draft' | 'published' | 'closed';
export type WorkspaceStatus =
  | 'provisioning'
  | 'running'
  | 'stopped'
  | 'failed'
  | 'archived';

export interface ProjectSummary {
  id: string;
  tenantId: string;
  title: string;
  description: string;
  runtimeTier: string;
  status: ProjectStatus;
  deadline: string | null;
  maxScore: number;
}

export interface ProjectForkRef {
  id: string;
  projectId: string;
  componentId: string;
  userId: string;
  workspaceId: string;
  sourceTemplateSlug: string | null;
  sourceWorkspaceId: string | null;
}

/** An AI-suggested project title/description (§2.11), with what it drew on. */
export interface ProjectCopySuggestion {
  title: string;
  description: string;
  basedOn: string[];
}

export interface ProjectComponentView {
  id: string;
  projectId: string;
  title: string;
  technology: string;
  templateSlug: string | null;
  templateWorkspaceId: string | null;
  position: number;
  fork: ProjectForkRef | null;
}

/** A project as a student sees it: components plus their own fork state. */
export interface StudentProjectView {
  project: ProjectSummary;
  components: ProjectComponentView[];
}

/** A project as an instructor sees it: components plus the fork roster size. */
export interface InstructorProjectView {
  project: ProjectSummary;
  components: ProjectComponentView[];
  forkCount: number;
}

export interface ForkStatus {
  forkId: string;
  workspaceId: string;
  status: WorkspaceStatus;
  tier: string | null;
  ideUrl: string | null;
  /** Public URL the service is exposed on after a Deploy (E5); null if none. */
  deployUrl: string | null;
  /** The container port the deploy exposes; null if not deployed. */
  deployPort: number | null;
  /** Latest auto-evaluation score (E4, ADR-13); null until the workspace is analysed. */
  qualityScore: number | null;
  /** When the latest auto-evaluation ran; null if never. */
  analyzedAt: string | null;
}

/** One issue the auto-evaluator raised, with the line it points at (when known). */
export interface QualityIssue {
  code: string;
  message: string;
  line: number | null;
}

/** An auto-evaluation result: a 0-100 score plus the explainable issues behind it. */
export interface QualityEvaluation {
  workspaceId: string;
  score: number | null;
  issueCount: number;
  issues: QualityIssue[];
  analyzedAt: string;
}

export interface ProjectSubmission {
  id: string;
  projectId: string;
  componentId: string;
  userId: string;
  workspaceId: string;
  title: string;
  description: string;
  githubUrl: string | null;
  demoUrl: string | null;
  status: 'submitted' | 'evaluated';
  score: number | null;
  feedback: string | null;
  /** Auto-evaluation copied from the workspace at submit time (E4, ADR-13). */
  autoScore: number | null;
  autoReport: string | null;
  autoEvaluatedAt: string | null;
  submittedAt: string;
  evaluatedAt: string | null;
}

/** A stored auto-evaluation run, as listed in a workspace's history. */
export interface QualityEvaluationRecord {
  id: string;
  score: number | null;
  issueCount: number;
  status: 'succeeded' | 'failed';
  error: string | null;
  report: { score: number; issueCount: number; issues: QualityIssue[] } | null;
  createdAt: string;
}

export interface StudentSubmissionView {
  submission: ProjectSubmission;
  workspace: { id: string; status: WorkspaceStatus } | null;
}

/** One enrolled course shown as a roadmap on the student dashboard. */
export interface DashboardRoadmap {
  courseId: string;
  slug: string;
  title: string;
  progress: number;
  lessonsComplete: number;
  lessonsTotal: number;
}

/** A competitive standing: the student's rank within a cohort. */
export interface DashboardRank {
  scope: 'university' | 'batch';
  label: string;
  rank: number;
  total: number;
  percentile: number;
  averageScore: number | null;
}

export interface DashboardProfileItem {
  key: string;
  label: string;
  done: boolean;
}

/** One outstanding item in the dashboard's "Up Next for You" widget. */
export interface DashboardUpNextItem {
  kind: 'project' | 'assessment';
  id: string;
  title: string;
  href: string;
  dueAt: string | null;
  detail: string;
}

/** The dashboard's "Resume Learning" widget: where to continue from. */
export interface DashboardResumeItem {
  courseId: string;
  courseSlug: string;
  courseTitle: string;
  lessonId: string;
  lessonTitle: string;
  href: string;
  progress: number;
}

/** The student dashboard's aggregated view (roadmaps, ranks, profile, next). */
export interface StudentDashboard {
  studentName: string;
  roadmaps: DashboardRoadmap[];
  rankings: DashboardRank[];
  profile: { percent: number; items: DashboardProfileItem[] };
  upNext: DashboardUpNextItem[];
  resume: DashboardResumeItem | null;
}

/** A recorded attendance status; 'not_marked' means no record exists yet. */
export type AttendanceStatus = 'present' | 'absent' | 'late' | 'excused' | 'not_marked';

export interface AttendanceCounts {
  present: number;
  absent: number;
  late: number;
  excused: number;
  marked: number;
}

export interface AttendanceSummary {
  percent: number;
  counts: AttendanceCounts;
}

/** The student's own attendance: an overall figure plus the session list. */
export interface StudentAttendance {
  overall: AttendanceSummary;
  sessions: Array<{
    sessionId: string;
    title: string;
    scheduledAt: string;
    status: AttendanceStatus;
  }>;
}

export interface ClassSession {
  id: string;
  batchId: string;
  title: string;
  scheduledAt: string;
}

/** The trainer's cohort matrix: roster x sessions with per-student percent. */
export interface BatchAttendance {
  batchId: string;
  batchName: string;
  sessions: Array<{ id: string; title: string; scheduledAt: string }>;
  rows: Array<{
    userId: string;
    fullName: string;
    email: string;
    percent: number;
    counts: AttendanceCounts;
    cells: Array<{ sessionId: string; status: AttendanceStatus }>;
  }>;
}

/** GitHub connection state for git publish. */
export interface GitStatus {
  connected: boolean;
  login: string | null;
  provider: string;
}

/** A lesson as the instructor's course editor sees it. */
export interface LessonEditor {
  id: string;
  title: string;
  type: string;
  kind: 'video' | 'reading' | 'lab' | 'quiz';
  position: number;
  maxScore: number;
  exerciseSlug: string | null;
  runtimeTier: string | null;
  hint: string | null;
  body: string | null;
  assessmentId: string | null;
}

export interface ModuleEditor {
  id: string;
  title: string;
  position: number;
  lessons: LessonEditor[];
}

/** A course in the authoring surface: drafts included, unlike the catalog. */
export interface CourseEditor {
  id: string;
  slug: string;
  title: string;
  description: string;
  status: string;
  modules: ModuleEditor[];
}

/** A device-flow grant: the code the student types at GitHub. */
export interface GitDeviceGrant {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

/** One publish of a workspace to the student's GitHub. */
export interface GitPublish {
  id: string;
  workspaceId: string;
  repoFullName: string;
  repoUrl: string;
  branch: string;
  status: 'succeeded' | 'failed';
  commitSha: string | null;
  error: string | null;
  createdAt: string;
}

/** Tenant cost and quota for the current billing period. */
export interface TenantUsage {
  tenantId: string;
  periodStart: string;
  totalCents: number;
  byTier: Record<string, number>;
  activeSessions: number;
  budget: {
    monthlyBudgetCents: number;
    spentCents: number;
    percent: number;
    level: 'ok' | 'warning' | 'exceeded';
  } | null;
}

// --------------------------------------------------------- P3: Skill Passport

/** One verified badge on a student's Skill Passport (parity §2.8). */
export interface PassportBadge {
  id: string;
  kind: 'lab' | 'assessment' | 'project' | 'interview';
  label: string;
  /** Score that earned it, 0-100, or null for a completion badge. */
  score: number | null;
  earnedAt: string;
}

/** A student's Skill Passport, derived on read from their evidence. */
export interface SkillPassport {
  userId: string;
  fullName: string;
  email: string;
  verifiedBadges: number;
  avgLabScore: number | null;
  avgAssessmentScore: number | null;
  communicationScore: number | null;
  badges: PassportBadge[];
  updatedAt: string;
}

/** One row of the recruiter shortlist. */
export interface RecruiterRow {
  userId: string;
  fullName: string;
  email: string;
  verifiedBadges: number;
  avgLabScore: number | null;
  communicationScore: number | null;
  /** 0-100 blended readiness, or null when there is no evidence yet. */
  readiness: number | null;
}

// ------------------------------------------------------- P3: AI Interviewer

/** One prompt in the AI Interviewer bank. */
export interface InterviewPrompt {
  id: string;
  title: string;
  question: string;
  expectedTerms: string[];
}

/** One scored mock-interview sitting. */
export interface InterviewAttempt {
  id: string;
  promptId: string;
  promptTitle: string;
  transcript: string;
  communicationScore: number;
  grammar: number;
  vocabulary: number;
  fillerWords: number;
  technicalAccuracy: number;
  createdAt: string;
}

// ------------------------------------------------------------ P3: AI Mentor

/** One turn in the AI Mentor conversation. */
export interface MentorTurn {
  id: string;
  role: 'user' | 'mentor';
  content: string;
  topic: string | null;
  createdAt: string;
}

/** The mentor's reply, with the steps it suggests. */
export interface MentorReply {
  reply: MentorTurn;
  nextSteps: string[];
  suggestedQuestion: string;
}

// ------------------------------------------------------- P3: Social + Feed

/** One post in the tenant micro-feed. */
export interface SocialPost {
  id: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string;
}

/** A member in the directory, with follow state. */
export interface SocialMember {
  userId: string;
  fullName: string;
  email: string;
  followers: number;
  following: number;
  followedByMe: boolean;
}

/** One item in the derived activity feed. */
export interface FeedItem {
  id: string;
  kind: string;
  actorId: string;
  actorName: string;
  title: string;
  detail: string | null;
  href: string | null;
  createdAt: string;
}

// --------------------------------------------------- P3: Question Bank

/** One reusable question in the tenant's bank. */
export interface BankQuestion {
  id: string;
  kind: 'coding' | 'mcq' | 'fill' | 'descriptive';
  prompt: string;
  options: string[];
  correct: unknown;
  maxScore: number;
  tags: string[];
  createdAt: string;
}

// ---------------------------------------------------- P3: Student Reports

/** One batch's cohort roll-up. */
export interface BatchReport {
  batchId: string;
  batchName: string;
  studentCount: number;
  avgCompletion: number;
  avgScore: number | null;
  attendancePercent: number | null;
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

// ------------------------------------------------- P3: Organizations

/** One department in the admin console. */
export interface Department {
  id: string;
  name: string;
  batchCount: number;
  createdAt: string;
}

/** The admin console's view of the tenant. */
export interface OrganizationView {
  tenant: {
    id: string;
    name: string;
    domain: string;
    plan: string;
    status: string;
    maxConcurrentLabs: number;
    monthlyBudgetCents: number;
    maxStorageGb: number;
  };
  departments: Department[];
  members: { total: number; students: number; instructors: number; admins: number };
  batchCount: number;
}

export const api = {
  session: () => request<Session | null>('/api/auth/session'),
  login: (email: string, password: string) =>
    request<Session>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  logout: () => request<void>('/api/auth/logout', { method: 'POST' }),
  /** The student dashboard's aggregated view (roadmaps, ranks, profile). */
  dashboard: () => request<StudentDashboard>('/api/dashboard'),
  courses: () => request<CourseSummary[]>('/api/catalog/courses'),
  course: (slug: string) => request<CourseSummary>(`/api/catalog/courses/${slug}`),
  lesson: (slug: string, lessonId: string) =>
    request<LessonDetail>(
      `/api/catalog/courses/${encodeURIComponent(slug)}/lessons/${encodeURIComponent(lessonId)}`,
    ),
  /** Authoring: every course in the tenant, drafts included. */
  authoringCourses: () => request<CourseEditor[]>('/api/authoring/courses'),
  /** Authoring: one course in full. */
  authoringCourse: (courseId: string) =>
    request<CourseEditor>(`/api/authoring/courses/${encodeURIComponent(courseId)}`),
  createCourse: (input: { title: string; description?: string }) =>
    request<CourseEditor>('/api/authoring/courses', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateCourse: (
    courseId: string,
    patch: Partial<{ title: string; description: string; slug: string }>,
  ) =>
    request<CourseEditor>(`/api/authoring/courses/${encodeURIComponent(courseId)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  publishCourse: (courseId: string) =>
    request<CourseEditor>(
      `/api/authoring/courses/${encodeURIComponent(courseId)}/publish`,
      { method: 'POST' },
    ),
  unpublishCourse: (courseId: string) =>
    request<CourseEditor>(
      `/api/authoring/courses/${encodeURIComponent(courseId)}/unpublish`,
      { method: 'POST' },
    ),
  deleteCourse: (courseId: string) =>
    request<void>(`/api/authoring/courses/${encodeURIComponent(courseId)}`, {
      method: 'DELETE',
    }),
  addModule: (courseId: string, title: string) =>
    request<ModuleEditor>(
      `/api/authoring/courses/${encodeURIComponent(courseId)}/modules`,
      { method: 'POST', body: JSON.stringify({ title }) },
    ),
  updateModule: (moduleId: string, patch: Partial<{ title: string; position: number }>) =>
    request<ModuleEditor>(`/api/authoring/courses/modules/${encodeURIComponent(moduleId)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteModule: (moduleId: string) =>
    request<void>(`/api/authoring/courses/modules/${encodeURIComponent(moduleId)}`, {
      method: 'DELETE',
    }),
  addLesson: (
    moduleId: string,
    input: {
      title: string;
      type: string;
      maxScore?: number;
      exerciseSlug?: string | null;
      runtimeTier?: string | null;
      hint?: string | null;
      body?: string | null;
      assessmentId?: string | null;
    },
  ) =>
    request<LessonEditor>(
      `/api/authoring/courses/modules/${encodeURIComponent(moduleId)}/lessons`,
      { method: 'POST', body: JSON.stringify(input) },
    ),
  updateLesson: (
    lessonId: string,
    patch: Partial<{
      title: string;
      type: string;
      position: number;
      maxScore: number;
      exerciseSlug: string | null;
      runtimeTier: string | null;
      hint: string | null;
      body: string | null;
      assessmentId: string | null;
    }>,
  ) =>
    request<LessonEditor>(`/api/authoring/courses/lessons/${encodeURIComponent(lessonId)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteLesson: (lessonId: string) =>
    request<void>(`/api/authoring/courses/lessons/${encodeURIComponent(lessonId)}`, {
      method: 'DELETE',
    }),
  launchLab: (lessonId: string) =>
    request<LabSession>('/api/labs/launch', {
      method: 'POST',
      body: JSON.stringify({ lessonId }),
    }),
  labSession: (sessionId: string) =>
    request<LabSession>(`/api/labs/sessions/${encodeURIComponent(sessionId)}`),
  batches: () => request<BatchSummary[]>('/api/batches'),
  createBatch: (name: string) =>
    request<BatchSummary>('/api/batches', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  students: () => request<RosterEntry[]>('/api/batches/students'),
  batchRoster: (batchId: string) =>
    request<RosterEntry[]>(`/api/batches/${encodeURIComponent(batchId)}/roster`),
  gradebook: (batchId: string) =>
    request<Gradebook>(`/api/batches/${encodeURIComponent(batchId)}/gradebook`),
  assignStudent: (batchId: string, userId: string, courseId: string) =>
    request<{ ok: true }>(`/api/batches/${encodeURIComponent(batchId)}/students`, {
      method: 'POST',
      body: JSON.stringify({ userId, courseId }),
    }),
  /** Attendance (E6c): the caller's own overall + session-level attendance. */
  myAttendance: () => request<StudentAttendance>('/api/attendance/me'),
  batchSessions: (batchId: string) =>
    request<ClassSession[]>(`/api/attendance/batches/${encodeURIComponent(batchId)}/sessions`),
  createClassSession: (batchId: string, input: { title: string; scheduledAt: string }) =>
    request<ClassSession>(`/api/attendance/batches/${encodeURIComponent(batchId)}/sessions`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  batchAttendance: (batchId: string) =>
    request<BatchAttendance>(`/api/attendance/batches/${encodeURIComponent(batchId)}`),
  markAttendance: (sessionId: string, userId: string, status: AttendanceStatus) =>
    request<{ ok: true }>(`/api/attendance/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ userId, status }),
    }),
  editorLanguages: () => request<EditorLanguage[]>('/api/editor/languages'),
  runCode: (input: { language: string; source: string; stdin: string }) =>
    request<CodeRunResult>('/api/editor/run', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  reviewCode: (input: {
    language: string;
    source: string;
    mode: TutorMode;
    stderr?: string;
  }) =>
    request<TutorReview>('/api/editor/review', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  snippets: () => request<Snippet[]>('/api/editor/snippets'),
  saveSnippet: (input: {
    language: string;
    title: string;
    source: string;
    stdin: string;
  }) =>
    request<Snippet>('/api/editor/snippets', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateSnippet: (
    id: string,
    patch: Partial<{ language: string; title: string; source: string; stdin: string }>,
  ) =>
    request<Snippet>(`/api/editor/snippets/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteSnippet: (id: string) =>
    request<void>(`/api/editor/snippets/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  assessments: () => request<AssessmentView[]>('/api/assessments'),
  assessment: (id: string) =>
    request<AssessmentView>(`/api/assessments/${encodeURIComponent(id)}`),
  /** Direct download URL for a proctored assessment's Safe Exam Browser config. */
  sebConfigUrl: (id: string) =>
    `${API_BASE}/api/assessments/${encodeURIComponent(id)}/seb`,
  startAttempt: (assessmentId: string, passcode?: string) =>
    request<AttemptView>(`/api/assessments/${encodeURIComponent(assessmentId)}/attempts`, {
      method: 'POST',
      body: JSON.stringify({ passcode }),
    }),
  attempt: (attemptId: string) =>
    request<AttemptView>(`/api/assessments/attempts/${encodeURIComponent(attemptId)}`),
  submitAttempt: (attemptId: string, answers: Record<string, unknown>) =>
    request<AttemptResult>(
      `/api/assessments/attempts/${encodeURIComponent(attemptId)}/submit`,
      { method: 'POST', body: JSON.stringify({ answers }) },
    ),
  attemptHistory: () => request<AttemptView[]>('/api/assessments/attempts'),
  reportIssue: (input: {
    category: SupportCategory;
    title: string;
    description: string;
    pageUrl?: string;
  }) =>
    request<SupportIssue>('/api/support/issues', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  supportIssues: () => request<SupportIssue[]>('/api/support/issues'),
  setSupportIssueStatus: (id: string, status: SupportStatus) =>
    request<SupportIssue>(`/api/support/issues/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
  recordProctorEvent: (attemptId: string, type: ProctorEventType, detail?: string) =>
    request<{ received: true }>(
      `/api/proctoring/attempts/${encodeURIComponent(attemptId)}/events`,
      { method: 'POST', body: JSON.stringify({ type, detail }) },
    ),
  proctorSummary: (attemptId: string) =>
    request<ProctorSummary>(
      `/api/proctoring/attempts/${encodeURIComponent(attemptId)}/summary`,
    ),
  proctoredAttempts: () => request<ProctoredAttemptRow[]>('/api/proctoring/attempts'),
  projectTemplates: () => request<ProjectTemplate[]>('/api/projects/templates'),
  /** AI-suggested project copy (§2.11); 503 when the AI plane is unconfigured. */
  suggestProjectCopy: (input: {
    hint?: string;
    stacks?: string[];
    componentTitles?: string[];
  }) =>
    request<ProjectCopySuggestion>('/api/projects/suggest-copy', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  projects: () => request<Array<StudentProjectView | InstructorProjectView>>('/api/projects'),
  project: (id: string) =>
    request<StudentProjectView | InstructorProjectView>(
      `/api/projects/${encodeURIComponent(id)}`,
    ),
  forkProjectComponent: (projectId: string, componentId: string) =>
    request<{ forkId: string; workspaceId: string; status: string; tier: string }>(
      `/api/projects/${encodeURIComponent(projectId)}/components/${encodeURIComponent(componentId)}/fork`,
      { method: 'POST' },
    ),
  forkStatus: (forkId: string) =>
    request<ForkStatus>(`/api/projects/forks/${encodeURIComponent(forkId)}`),
  stopWorkspace: (workspaceId: string) =>
    request<{ workspaceId: string; status: string }>(
      `/api/projects/workspaces/${encodeURIComponent(workspaceId)}/stop`,
      { method: 'POST' },
    ),
  /** Delete (Nov'25 §1.5): destroy the workspace, its volume, and its fork. */
  deleteWorkspace: (workspaceId: string) =>
    request<{ workspaceId: string; deleted: true }>(
      `/api/projects/workspaces/${encodeURIComponent(workspaceId)}`,
      { method: 'DELETE' },
    ),
  /** Deploy (E5): expose the workspace's service on a public URL. */
  deployWorkspace: (workspaceId: string, port: number) =>
    request<{ workspaceId: string; deployUrl: string | null; deployPort: number | null }>(
      `/api/projects/workspaces/${encodeURIComponent(workspaceId)}/deploy`,
      { method: 'POST', body: JSON.stringify({ port }) },
    ),
  /** Withdraw a workspace's exposed service. */
  undeployWorkspace: (workspaceId: string) =>
    request<{ workspaceId: string; deployUrl: string | null; deployPort: number | null }>(
      `/api/projects/workspaces/${encodeURIComponent(workspaceId)}/deploy`,
      { method: 'DELETE' },
    ),
  /** Auto-evaluate (E4): score the workspace's source and return the issues. */
  analyzeWorkspace: (workspaceId: string) =>
    request<QualityEvaluation>(
      `/api/projects/workspaces/${encodeURIComponent(workspaceId)}/analyze`,
      { method: 'POST' },
    ),
  /** A workspace's auto-evaluation history, newest first. */
  workspaceEvaluations: (workspaceId: string) =>
    request<QualityEvaluationRecord[]>(
      `/api/projects/workspaces/${encodeURIComponent(workspaceId)}/evaluations`,
    ),
  myProjectSubmissions: () =>
    request<StudentSubmissionView[]>('/api/projects/submissions'),
  submitProject: (
    projectId: string,
    componentId: string,
    input: {
      workspaceId: string;
      title: string;
      description: string;
      githubUrl?: string | null;
      demoUrl?: string | null;
    },
  ) =>
    request<ProjectSubmission>(
      `/api/projects/${encodeURIComponent(projectId)}/components/${encodeURIComponent(componentId)}/submissions`,
      { method: 'POST', body: JSON.stringify(input) },
    ),
  projectSubmissions: (projectId: string) =>
    request<ProjectSubmission[]>(
      `/api/projects/${encodeURIComponent(projectId)}/submissions`,
    ),
  evaluateSubmission: (submissionId: string, score: number, feedback: string) =>
    request<ProjectSubmission>(
      `/api/projects/submissions/${encodeURIComponent(submissionId)}`,
      { method: 'PATCH', body: JSON.stringify({ score, feedback }) },
    ),
  createProject: (input: {
    title: string;
    description?: string;
    deadline?: string | null;
    maxScore?: number;
  }) =>
    request<ProjectSummary>('/api/projects', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  addProjectComponent: (
    projectId: string,
    input: { title: string; technology: string; templateSlug?: string | null },
  ) =>
    request<ProjectComponentView>(
      `/api/projects/${encodeURIComponent(projectId)}/components`,
      { method: 'POST', body: JSON.stringify(input) },
    ),
  publishProject: (projectId: string) =>
    request<ProjectSummary>(`/api/projects/${encodeURIComponent(projectId)}/publish`, {
      method: 'POST',
    }),
  /** Git publish: the caller's GitHub connection state. */
  gitStatus: () => request<GitStatus>('/api/git/status'),
  /** Git publish: begin a device-flow connection. */
  gitConnectStart: () =>
    request<GitDeviceGrant>('/api/git/connect/start', { method: 'POST' }),
  /** Git publish: finish a device-flow connection. */
  gitConnectComplete: (deviceCode: string) =>
    request<{ connected: boolean; login: string | null; provider: string }>(
      '/api/git/connect/complete',
      { method: 'POST', body: JSON.stringify({ deviceCode }) },
    ),
  /** Git publish: disconnect the GitHub account. */
  gitDisconnect: () =>
    request<{ connected: boolean }>('/api/git/connect', { method: 'DELETE' }),
  /** Git publish: publish a running workspace to the student's GitHub. */
  gitPublish: (workspaceId: string, input?: { repoName?: string; branch?: string }) =>
    request<GitPublish>(
      `/api/git/workspaces/${encodeURIComponent(workspaceId)}/publish`,
      { method: 'POST', body: JSON.stringify(input ?? {}) },
    ),
  /** Git publish: the caller's publish history for a workspace. */
  gitPublishes: (workspaceId: string) =>
    request<GitPublish[]>(
      `/api/git/workspaces/${encodeURIComponent(workspaceId)}/publishes`,
    ),
  /** Tenant cost and quota for the current billing period. */
  usage: () => request<TenantUsage>('/api/labs/usage'),
  // ------------------------------------------------------------- P3 surfaces
  /** Skill Passport: the caller's own passport. */
  passport: () => request<SkillPassport>('/api/passport/me'),
  /** Skill Passport: the recruiter shortlist (instructor/admin only). */
  recruiterPassports: (filters: {
    minLabScore?: number;
    minCommunicationScore?: number;
    query?: string;
  } = {}) => {
    const qs = new URLSearchParams();
    if (filters.minLabScore != null) qs.set('minLabScore', String(filters.minLabScore));
    if (filters.minCommunicationScore != null) {
      qs.set('minCommunicationScore', String(filters.minCommunicationScore));
    }
    if (filters.query) qs.set('query', filters.query);
    const suffix = qs.toString() ? `?${qs}` : '';
    return request<RecruiterRow[]>(`/api/passport/recruiter${suffix}`);
  },
  /** AI Interviewer: the prompt bank. */
  interviewPrompts: () => request<InterviewPrompt[]>('/api/interviews/prompts'),
  /** AI Interviewer: the caller's sittings. */
  interviewHistory: () => request<InterviewAttempt[]>('/api/interviews/me'),
  /** AI Interviewer: submit an answer for scoring. */
  submitInterview: (promptId: string, transcript: string) =>
    request<InterviewAttempt>('/api/interviews', {
      method: 'POST',
      body: JSON.stringify({ promptId, transcript }),
    }),
  /** AI Mentor: the caller's conversation. */
  mentorHistory: () => request<MentorTurn[]>('/api/mentor/messages'),
  /** AI Mentor: ask a question; the answer is appended to the conversation. */
  askMentor: (question: string) =>
    request<MentorReply>('/api/mentor/messages', {
      method: 'POST',
      body: JSON.stringify({ question }),
    }),
  /** AI Mentor: clear the conversation. */
  clearMentor: () => request<{ cleared: true }>('/api/mentor/messages', { method: 'DELETE' }),
  /** Feed: cohort activity, newest first. */
  feed: () => request<FeedItem[]>('/api/feed'),
  /** Social: the tenant feed; `followingOnly` narrows to followed peers. */
  socialFeed: (followingOnly = false) =>
    request<SocialPost[]>(`/api/social/feed${followingOnly ? '?following=1' : ''}`),
  /** Social: the tenant directory with follow state. */
  socialMembers: () => request<SocialMember[]>('/api/social/members'),
  /** Social: publish a post. */
  createPost: (body: string) =>
    request<SocialPost>('/api/social/posts', {
      method: 'POST',
      body: JSON.stringify({ body }),
    }),
  /** Social: delete a post the caller owns. */
  deletePost: (id: string) =>
    request<{ deleted: true }>(`/api/social/posts/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  /** Social: follow a peer. */
  followMember: (userId: string) =>
    request<{ following: true }>(`/api/social/follows/${encodeURIComponent(userId)}`, {
      method: 'POST',
    }),
  /** Social: unfollow a peer. */
  unfollowMember: (userId: string) =>
    request<{ following: false }>(`/api/social/follows/${encodeURIComponent(userId)}`, {
      method: 'DELETE',
    }),
  /** Question Bank: the tenant's questions. */
  bankQuestions: (filters: { kind?: string; tag?: string } = {}) => {
    const qs = new URLSearchParams();
    if (filters.kind) qs.set('kind', filters.kind);
    if (filters.tag) qs.set('tag', filters.tag);
    const suffix = qs.toString() ? `?${qs}` : '';
    return request<BankQuestion[]>(`/api/question-bank${suffix}`);
  },
  /** Question Bank: add a question. */
  createBankQuestion: (input: {
    kind: string;
    prompt: string;
    options?: string[];
    correct?: unknown;
    maxScore?: number;
    tags?: string[];
  }) =>
    request<BankQuestion>('/api/question-bank', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  /** Question Bank: remove a question. */
  deleteBankQuestion: (id: string) =>
    request<{ deleted: true }>(`/api/question-bank/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  /** Student Reports: every batch's cohort roll-up. */
  batchReports: () => request<BatchReport[]>('/api/reports/batches'),
  /** Student Reports: one batch's roll-up plus its per-student rows. */
  batchReport: (batchId: string) =>
    request<BatchReportDetail>(`/api/reports/batches/${encodeURIComponent(batchId)}`),
  /** Organizations: the admin console's tenant view. */
  organization: () => request<OrganizationView>('/api/organizations'),
  /** Organizations: create a department. */
  createDepartment: (name: string) =>
    request<Department>('/api/organizations/departments', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  /** Organizations: delete a department. */
  deleteDepartment: (id: string) =>
    request<{ deleted: true }>(`/api/organizations/departments/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
};
