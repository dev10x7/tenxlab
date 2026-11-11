/**
 * Authoritative exam timer.
 *
 * The server owns the exam clock: it stamps the start, computes the deadline
 * from the configured duration, and decides whether a submission is still in
 * time. A client-reported timestamp is never trusted, so a student cannot buy
 * extra minutes by tampering with the browser clock. The current time is
 * injected (`Clock`) so the logic is deterministic under test.
 */

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export interface ExamWindow {
  attemptId: string;
  /** Server-stamped start time. */
  startedAt: Date;
  durationSeconds: number;
  /** Server-computed deadline; submissions after this are late. */
  endsAt: Date;
}

export function startExamWindow(
  attemptId: string,
  durationSeconds: number,
  clock: Clock = systemClock,
): ExamWindow {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error('durationSeconds must be a positive number');
  }
  const startedAt = clock.now();
  const endsAt = new Date(startedAt.getTime() + durationSeconds * 1000);
  return { attemptId, startedAt, durationSeconds, endsAt };
}

/** Seconds left before the deadline, clamped to zero once it has passed. */
export function remainingSeconds(
  window: ExamWindow,
  clock: Clock = systemClock,
): number {
  const ms = window.endsAt.getTime() - clock.now().getTime();
  return ms <= 0 ? 0 : Math.ceil(ms / 1000);
}

export function isExpired(
  window: ExamWindow,
  clock: Clock = systemClock,
): boolean {
  return clock.now().getTime() >= window.endsAt.getTime();
}

/**
 * Whether the attempt should be force-submitted now. True once the deadline
 * has passed; the caller drives auto-submit from this rather than trusting a
 * client "time is up" signal.
 */
export function shouldAutoSubmit(
  window: ExamWindow,
  clock: Clock = systemClock,
): boolean {
  return isExpired(window, clock);
}

export type SubmissionDecision =
  | { accepted: true; remainingSeconds: number }
  | { accepted: false; reason: 'expired'; remainingSeconds: 0 };

/**
 * Decide whether a submission is in time. A small grace period absorbs network
 * latency and clock skew between the client and the deadline; it never extends
 * the visible time the student is shown.
 */
export function evaluateSubmission(
  window: ExamWindow,
  clock: Clock = systemClock,
  graceSeconds = 0,
): SubmissionDecision {
  const deadline = window.endsAt.getTime() + graceSeconds * 1000;
  if (clock.now().getTime() > deadline) {
    return { accepted: false, reason: 'expired', remainingSeconds: 0 };
  }
  return { accepted: true, remainingSeconds: remainingSeconds(window, clock) };
}
