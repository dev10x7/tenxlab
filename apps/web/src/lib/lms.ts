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

/**
 * Format a countdown as `m:ss` (or `h:mm:ss` past an hour). Negative remaining
 * time is clamped to zero so an expired exam reads `0:00`, never `-1:30`.
 */
export function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** A clock is "urgent" (rendered red) in its last two minutes. */
export function clockUrgent(seconds: number): boolean {
  return seconds <= 120;
}

/** Human label for a proctoring risk band. */
export function riskLevelLabel(level: 'low' | 'medium' | 'high'): string {
  if (level === 'high') return 'High risk';
  if (level === 'medium') return 'Review';
  return 'Low risk';
}

/** One-line summary of a proctoring risk score, e.g. "Review · 3 signals · score 25". */
export function riskSummaryLabel(summary: {
  eventCount: number;
  riskScore: number;
  riskLevel: 'low' | 'medium' | 'high';
}): string {
  const signals = summary.eventCount === 1 ? '1 signal' : `${summary.eventCount} signals`;
  return `${riskLevelLabel(summary.riskLevel)} · ${signals} · score ${summary.riskScore}`;
}

/** Countdown text for an attempt, or a dash when the assessment is untimed. */
export function attemptClockLabel(remainingSeconds: number | null): string {
  return remainingSeconds == null ? 'Untimed' : formatClock(remainingSeconds);
}

/** Human label for a project workspace lifecycle state. */
export function workspaceStatusLabel(status: string): string {
  switch (status) {
    case 'provisioning':
      return 'Starting…';
    case 'running':
      return 'Running';
    case 'stopped':
      return 'Stopped';
    case 'failed':
      return 'Failed';
    case 'archived':
      return 'Archived';
    default:
      return status;
  }
}

/**
 * Whether a fork's workspace is ready for the student to open in the IDE, still
 * starting, or broken. Drives the fork button's polling loop.
 */
export function forkReadyState(status: {
  status: string;
  ideUrl?: string | null;
}): { ready: boolean; failed: boolean; ideUrl: string | null } {
  if (status.status === 'failed') return { ready: false, failed: true, ideUrl: null };
  if (status.status === 'running' && status.ideUrl) {
    return { ready: true, failed: false, ideUrl: status.ideUrl };
  }
  return { ready: false, failed: false, ideUrl: null };
}

/**
 * Whether a workspace may be submitted. A submission snapshots a *stopped*
 * workspace, so a running or starting one must be stopped first (ByteXL's rule).
 */
export function canSubmitWorkspace(status: string): boolean {
  return status === 'stopped';
}

/** Human label for a submission's evaluation state. */
export function submissionStatusLabel(submission: {
  status: string;
  score: number | null;
}): string {
  if (submission.status === 'evaluated') {
    return submission.score == null ? 'Evaluated' : `Evaluated — ${submission.score}`;
  }
  return 'Submitted';
}

/**
 * Whether a project's deadline has passed relative to `now`, which closes it
 * for submission. A project with no deadline is never closed by the clock.
 */
export function projectDeadlinePassed(
  deadline: string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!deadline) return false;
  const at = new Date(deadline).getTime();
  return !Number.isNaN(at) && at < now.getTime();
}

/** One-line deadline label for a project card. */
export function projectDeadlineLabel(
  deadline: string | null | undefined,
  now: Date = new Date(),
): string {
  if (!deadline) return 'No deadline';
  if (projectDeadlinePassed(deadline, now)) return 'Closed — deadline passed';
  const date = new Date(deadline);
  if (Number.isNaN(date.getTime())) return 'No deadline';
  return `Due ${date.toLocaleDateString()}`;
}

