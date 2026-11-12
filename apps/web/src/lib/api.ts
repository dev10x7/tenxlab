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
};
