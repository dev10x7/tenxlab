/**
 * Pure helpers for the web client. Kept free of React and fetch so they can be
 * unit-tested with plain node:test.
 */

export interface LabSessionStatus {
  status: 'WARM' | 'ACTIVE' | 'IDLE' | 'TERMINATED' | 'FAILED';
  ideUrl?: string | null;
}

/** Map a partner-SSO failure reason to a human-readable login message. */
export function ssoErrorMessage(reason: string | null | undefined): string | null {
  switch (reason) {
    case 'invalid_signature':
      return 'Your sign-in link is invalid. Please start from your college portal.';
    case 'token_expired':
      return 'Your sign-in link has expired. Please start again from your college portal.';
    case 'replay_detected':
      return 'This sign-in link was already used. Please start again from your college portal.';
    case 'unknown_partner':
      return 'Your institution is not registered with TenXLab.';
    case 'user_not_found':
      return 'We could not find your account. Contact your institution administrator.';
    default:
      return null;
  }
}

/**
 * Init for the web proxy's upstream fetch to the LMS API.
 *
 * Next.js patches global fetch and caches route-handler responses by URL. Lab
 * session polls hit the same URL while the status changes underneath, so the
 * read must be uncached or the poll replays the first (WARM) response forever.
 */
export function proxyFetchInit(input: {
  method: string;
  headers: Headers;
  body?: string;
}): RequestInit {
  return { ...input, redirect: 'manual', cache: 'no-store' };
}

/**
 * Whether a launched lab is ready for the student, still starting, or broken.
 * Drives the launch button's polling loop.
 */
export function labLaunchState(session: LabSessionStatus): {
  ready: boolean;
  failed: boolean;
  ideUrl: string | null;
} {
  if (session.status === 'FAILED') return { ready: false, failed: true, ideUrl: null };
  if (session.status === 'ACTIVE' && session.ideUrl) {
    return { ready: true, failed: false, ideUrl: session.ideUrl };
  }
  return { ready: false, failed: false, ideUrl: null };
}

/** A lesson's display state given the student's progress record. */
export function lessonStatusLabel(
  status: 'not_started' | 'in_progress' | 'complete',
  score: number | null | undefined,
): string {
  if (status === 'complete') {
    return score == null ? 'Completed' : `Completed — ${score}%`;
  }
  if (status === 'in_progress') return 'In progress';
  return 'Not started';
}

/** Percentage of lessons complete, rounded, clamped to 0..100. */
export function courseProgress(lessons: Array<{ status: string }>): number {
  if (lessons.length === 0) return 0;
  const done = lessons.filter((l) => l.status === 'complete').length;
  return Math.min(100, Math.max(0, Math.round((done / lessons.length) * 100)));
}

/** One-line gradebook summary for a roster row, e.g. "1/2 lessons · avg 90%". */
export function gradebookRowSummary(row: {
  completed: number;
  total: number;
  averageScore: number | null;
}): string {
  const progress = `${row.completed}/${row.total} lessons`;
  return row.averageScore == null
    ? `${progress} · not graded`
    : `${progress} · avg ${row.averageScore}%`;
}

/** Short label for a gradebook cell: the score, or the progress status. */
export function gradebookCellLabel(cell: {
  status: string;
  score: number | null;
}): string {
  if (cell.score != null) return `${cell.score}%`;
  if (cell.status === 'in_progress') return 'In progress';
  if (cell.status === 'complete') return 'Done';
  return '—';
}

/** A snippet's display title, or a fallback for an untitled one. */
export function snippetTitle(title: string | null | undefined): string {
  const trimmed = (title ?? '').trim();
  return trimmed.length > 0 ? trimmed : 'Untitled';
}

/**
 * One-line status for a code run, for the editor's output header. Distinguishes
 * a clean exit, a non-zero exit, a timeout, and an unsupported runtime.
 */
export function runStatusLabel(result: {
  exitCode: number | null;
  timedOut: boolean;
  unsupported: boolean;
  executionTimeMs: number;
}): string {
  if (result.unsupported) return 'Runtime unavailable';
  if (result.timedOut) return 'Timed out';
  if (result.exitCode === 0) return `Finished in ${result.executionTimeMs} ms`;
  if (result.exitCode === null) return 'Stopped';
  return `Exited with code ${result.exitCode}`;
}

/** Whether a run produced anything worth showing in the output pane. */
export function runHasOutput(result: { stdout: string; stderr: string }): boolean {
  return result.stdout.length > 0 || result.stderr.length > 0;
}

