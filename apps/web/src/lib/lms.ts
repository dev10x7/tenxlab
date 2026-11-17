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
 * Whether a request method carries a body the proxy must forward. GET and HEAD
 * have none; every other verb (POST/PATCH/PUT/DELETE) must pass its body
 * through, or the upstream API sees an empty payload and rejects the write.
 */
export function methodHasBody(method: string): boolean {
  return method !== 'GET' && method !== 'HEAD';
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

/** A fork's row in the Nimbus landing's "Your workspaces" list. */
export interface NimbusWorkspaceRow {
  projectId: string;
  projectTitle: string;
  componentTitle: string;
  technology: string;
  forkId: string;
  /** The workspace the quick actions act on (stop/deploy/download/delete). */
  workspaceId: string;
  status: string;
  ideUrl: string | null;
  deployUrl: string | null;
}

/** A project the student can still fork, with how many components they have left. */
export interface NimbusOpenProject {
  projectId: string;
  title: string;
  deadline: string | null;
  totalComponents: number;
  forkedComponents: number;
}

/** The consolidated Nimbus landing view (Nov'25 §1.5). */
export interface NimbusLanding {
  workspaces: NimbusWorkspaceRow[];
  openProjects: NimbusOpenProject[];
  /** Counts for the summary strip, computed once so the page stays declarative. */
  counts: {
    workspaces: number;
    running: number;
    liveApps: number;
    openProjects: number;
    submissions: number;
  };
}

/**
 * Fold the raw projects + fork statuses + submissions the API returns into the
 * one landing view ByteXL shows: every workspace (with the quick actions its
 * status allows), the projects still open to fork, and the headline counts.
 *
 * Kept pure so the shape is unit-testable without a DOM (the page is a thin
 * renderer over this).
 */
export function nimbusLanding(input: {
  projects: Array<{
    project: { id: string; title: string; deadline: string | null };
    components: Array<{
      title: string;
      technology: string;
      fork: { id: string } | null;
    }>;
  }>;
  statuses: Record<
    string,
    { workspaceId: string; status: string; ideUrl: string | null; deployUrl: string | null }
  >;
  submissionCount: number;
}): NimbusLanding {
  const workspaces: NimbusWorkspaceRow[] = [];
  const openProjects: NimbusOpenProject[] = [];

  for (const view of input.projects) {
    const forked = view.components.filter((c) => c.fork);
    for (const component of forked) {
      const fork = component.fork!;
      const status = input.statuses[fork.id];
      workspaces.push({
        projectId: view.project.id,
        projectTitle: view.project.title,
        componentTitle: component.title,
        technology: component.technology,
        forkId: fork.id,
        workspaceId: status?.workspaceId ?? '',
        status: status?.status ?? 'provisioning',
        ideUrl: status?.ideUrl ?? null,
        deployUrl: status?.deployUrl ?? null,
      });
    }
    if (forked.length < view.components.length) {
      openProjects.push({
        projectId: view.project.id,
        title: view.project.title,
        deadline: view.project.deadline,
        totalComponents: view.components.length,
        forkedComponents: forked.length,
      });
    }
  }

  return {
    workspaces,
    openProjects,
    counts: {
      workspaces: workspaces.length,
      running: workspaces.filter((w) => w.status === 'running').length,
      liveApps: workspaces.filter((w) => w.deployUrl).length,
      openProjects: openProjects.length,
      submissions: input.submissionCount,
    },
  };
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

/** Format USD cents as a display string, e.g. 1234 -> "$12.34". */
export function formatUsd(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  return `${sign}$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** A rank's standing as a percentile label, e.g. "Top 10%" or "Bottom half". */
export function rankPercentileLabel(percentile: number): string {
  const pct = Math.min(Math.max(Math.round(percentile), 0), 100);
  if (pct >= 50) {
    const top = 100 - pct;
    return top <= 0 ? 'Top of the cohort' : `Top ${top}%`;
  }
  return 'Bottom half';
}

/** Display label for a template's picker category (Nov'25 §1.5). */
export function templateCategoryLabel(category: string): string {
  switch (category) {
    case 'front_end':
      return 'Front end';
    case 'back_end':
      return 'Backend';
    case 'full_stack':
      return 'Full stack';
    case 'database':
      return 'Database';
    default:
      return 'Other templates';
  }
}

/** Display label for an attendance status, including the unmarked state. */
export function attendanceStatusLabel(status: string): string {
  switch (status) {
    case 'present':
      return 'Present';
    case 'absent':
      return 'Absent';
    case 'late':
      return 'Late';
    case 'excused':
      return 'Excused';
    default:
      return 'Not marked';
  }
}

/** A short CSS class for an attendance status cell (drives the colour). */
export function attendanceStatusClass(status: string): string {
  switch (status) {
    case 'present':
      return 'present';
    case 'absent':
      return 'absent';
    case 'late':
      return 'late';
    case 'excused':
      return 'excused';
    default:
      return 'not_marked';
  }
}

/**
 * The attendance standing as a short label, flagging a shortfall. ByteXL flags
 * students under the typical 75% threshold, so the label calls that out.
 */
export function attendancePercentLabel(percent: number): string {
  const pct = Math.min(Math.max(Math.round(percent), 0), 100);
  return pct < 75 ? `${pct}% — below 75%` : `${pct}%`;
}


// ------------------------------------------------------------ P3 helpers

/** A 0-100 score as "NN%" or "—" when null. */
export function scoreLabel(score: number | null | undefined): string {
  if (score == null) return '—';
  return `${Math.min(Math.max(Math.round(score), 0), 100)}%`;
}

/** How ready a candidate looks from their passport evidence, as a label. */
export function readinessLabel(readiness: number | null): string {
  if (readiness == null) return 'No evidence yet';
  if (readiness >= 75) return 'Interview ready';
  if (readiness >= 50) return 'Developing';
  return 'Early';
}

/** The badge kind as a title-cased label, e.g. "lab" -> "Lab". */
export function badgeKindLabel(kind: string): string {
  const labels: Record<string, string> = {
    lab: 'Lab',
    assessment: 'Assessment',
    project: 'Project',
    interview: 'Interview',
  };
  return labels[kind] ?? 'Badge';
}

/** The question kind as a title-cased label. */
export function questionKindLabel(kind: string): string {
  const labels: Record<string, string> = {
    coding: 'Coding',
    mcq: 'Multiple choice',
    fill: 'Fill in the blank',
    descriptive: 'Descriptive',
  };
  return labels[kind] ?? 'Question';
}

/** The feed item kind as a title-cased label. */
export function feedKindLabel(kind: string): string {
  const labels: Record<string, string> = {
    submission: 'Submission',
    completion: 'Completion',
    post: 'Post',
  };
  return labels[kind] ?? 'Activity';
}

/**
 * The communication score as a label with a qualitative band, mirroring how
 * ByteXL frames soft-skills scoring for students.
 */
export function communicationLabel(score: number | null): string {
  if (score == null) return 'Not yet interviewed';
  const pct = Math.min(Math.max(Math.round(score), 0), 100);
  if (pct >= 80) return `${pct}% — strong`;
  if (pct >= 60) return `${pct}% — solid`;
  return `${pct}% — needs practice`;
}

/** The contest phase as a title-cased label, e.g. "live" -> "Live". */
export function contestPhaseLabel(phase: string): string {
  const labels: Record<string, string> = {
    draft: 'Draft',
    scheduled: 'Scheduled',
    live: 'Live now',
    ended: 'Ended',
  };
  return labels[phase] ?? 'Contest';
}

/** Whether a contest is open to enter and score right now. */
export function contestIsLive(phase: string): boolean {
  return phase === 'live';
}

/** A completion duration in ms as a compact label, e.g. 95000 -> "1m 35s". */
export function durationLabel(ms: number): string {
  const totalSeconds = Math.max(Math.round(ms / 1000), 0);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

/**
 * Append a browser request's query string to an upstream path. Route handlers
 * build the path from the catch-all segments, so the query is the one thing
 * they cannot reconstruct — filters and pagination would be silently dropped
 * without this.
 */
export function withQuery(path: string, search: string): string {
  return search ? `${path}${search}` : path;
}

/** A similarity ratio (0-1) as a percentage label, e.g. 0.93 -> "93%". */
export function similarityLabel(ratio: number): string {
  const pct = Math.min(Math.max(Math.round(ratio * 100), 0), 100);
  return `${pct}%`;
}

/** The Clarity skill as a title-cased label, e.g. "listening" -> "Listening". */
export function claritySkillLabel(skill: string): string {
  const labels: Record<string, string> = {
    reading: 'Reading',
    writing: 'Writing',
    listening: 'Listening',
    speaking: 'Speaking',
  };
  return labels[skill] ?? 'Skill';
}

/**
 * A CEFR band with its tier name, e.g. "B2" -> "B2 — Upper intermediate". The
 * tier wording is the Council of Europe's, so a student sees what a band means.
 */
export function cefrBandLabel(band: string | null): string {
  if (!band) return 'Not yet assessed';
  const tiers: Record<string, string> = {
    A1: 'Beginner',
    A2: 'Elementary',
    B1: 'Intermediate',
    B2: 'Upper intermediate',
    C1: 'Advanced',
    C2: 'Proficient',
  };
  const tier = tiers[band];
  return tier ? `${band} — ${tier}` : band;
}
