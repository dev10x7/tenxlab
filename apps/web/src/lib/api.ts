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

export interface ProjectTemplate {
  id: string;
  slug: string;
  title: string;
  description: string;
  kind: ProjectTemplateKind;
  stack: string;
  image: string;
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
  submittedAt: string;
  evaluatedAt: string | null;
}

export interface StudentSubmissionView {
  submission: ProjectSubmission;
  workspace: { id: string; status: WorkspaceStatus } | null;
}

/** GitHub connection state for git publish. */
export interface GitStatus {
  connected: boolean;
  login: string | null;
  provider: string;
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

export const api = {
  session: () => request<Session | null>('/api/auth/session'),
  login: (email: string, password: string) =>
    request<Session>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  logout: () => request<void>('/api/auth/logout', { method: 'POST' }),
  courses: () => request<CourseSummary[]>('/api/catalog/courses'),
  course: (slug: string) => request<CourseSummary>(`/api/catalog/courses/${slug}`),
  lesson: (slug: string, lessonId: string) =>
    request<LessonDetail>(
      `/api/catalog/courses/${encodeURIComponent(slug)}/lessons/${encodeURIComponent(lessonId)}`,
    ),
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
  editorLanguages: () => request<EditorLanguage[]>('/api/editor/languages'),
  runCode: (input: { language: string; source: string; stdin: string }) =>
    request<CodeRunResult>('/api/editor/run', {
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
  startAttempt: (assessmentId: string) =>
    request<AttemptView>(`/api/assessments/${encodeURIComponent(assessmentId)}/attempts`, {
      method: 'POST',
    }),
  attempt: (attemptId: string) =>
    request<AttemptView>(`/api/assessments/attempts/${encodeURIComponent(attemptId)}`),
  submitAttempt: (attemptId: string, answers: Record<string, unknown>) =>
    request<AttemptResult>(
      `/api/assessments/attempts/${encodeURIComponent(attemptId)}/submit`,
      { method: 'POST', body: JSON.stringify({ answers }) },
    ),
  attemptHistory: () => request<AttemptView[]>('/api/assessments/attempts'),
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
};
