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
