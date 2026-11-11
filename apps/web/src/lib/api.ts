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
}

export interface CourseSummary {
  slug: string;
  title: string;
  description: string;
  lessons: LessonSummary[];
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
  launchLab: (lessonId: string) =>
    request<LabSession>('/api/labs/launch', {
      method: 'POST',
      body: JSON.stringify({ lessonId }),
    }),
  labSession: (sessionId: string) =>
    request<LabSession>(`/api/labs/sessions/${encodeURIComponent(sessionId)}`),
};
