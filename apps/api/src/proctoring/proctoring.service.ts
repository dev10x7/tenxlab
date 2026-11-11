/**
 * Proctoring: ingest integrity events and generate Safe Exam Browser (SEB)
 * configuration.
 *
 * The LMS does not attempt to detect cheating by itself; it records a stream of
 * client-reported events (tab blur, copy/paste, multiple displays, VM
 * detection), aggregates them into a per-attempt risk score, and surfaces that
 * to the instructor alongside the attempt. SEB configuration is generated so a
 * locked-down browser can be required for high-stakes assessments.
 */

export type ProctorEventType =
  | 'focus_lost'
  | 'focus_gained'
  | 'copy'
  | 'paste'
  | 'fullscreen_exit'
  | 'display_count'
  | 'vm_detected'
  | 'network_lost';

export interface ProctorEvent {
  attemptId: string;
  type: ProctorEventType;
  at: string;
  detail?: string;
}

/** Per-event risk weight. Multi-display and VM detection are the strongest signals. */
const WEIGHTS: Record<ProctorEventType, number> = {
  focus_lost: 5,
  focus_gained: 0,
  copy: 8,
  paste: 12,
  fullscreen_exit: 10,
  display_count: 20,
  vm_detected: 30,
  network_lost: 2,
};

export interface ProctorSummary {
  attemptId: string;
  eventCount: number;
  riskScore: number;
  riskLevel: 'low' | 'medium' | 'high';
  counts: Partial<Record<ProctorEventType, number>>;
}

/** Risk at or above this level should be reviewed before a grade is released. */
export const REVIEW_THRESHOLD = 30;

export function summarizeEvents(
  attemptId: string,
  events: ProctorEvent[],
): ProctorSummary {
  const counts: Partial<Record<ProctorEventType, number>> = {};
  let riskScore = 0;

  for (const e of events) {
    if (e.attemptId !== attemptId) continue;
    counts[e.type] = (counts[e.type] ?? 0) + 1;
    riskScore += WEIGHTS[e.type] ?? 0;
  }

  const riskLevel: ProctorSummary['riskLevel'] =
    riskScore >= REVIEW_THRESHOLD ? 'high' : riskScore >= 15 ? 'medium' : 'low';

  const eventCount = Object.values(counts).reduce((a, b) => a + (b ?? 0), 0);
  return { attemptId, eventCount, riskScore, riskLevel, counts };
}

export interface SebConfigInput {
  /** URL the locked-down browser should open. */
  startUrl: string;
  /** SEB browser exam key (from the SEB config tool). */
  browserExamKey?: string;
  /** Allow switching to other applications. Default false. */
  allowSwitchApps?: boolean;
  /** Show a clock in the SEB toolbar. */
  showClock?: boolean;
}

/**
 * Produce a Safe Exam Browser configuration object. SEB accepts a plist-like
 * structure; we emit the JSON equivalent that the SEB config tool and the
 * `sebserver` accept for the common settings.
 */
export function buildSebConfig(input: SebConfigInput): Record<string, unknown> {
  return {
    startURL: input.startUrl,
    browserExamKey: input.browserExamKey ?? '',
    allowSwitchToApplications: input.allowSwitchApps ?? false,
    allowQuit: false,
    showTaskBar: false,
    showReloadButton: false,
    showTimeClock: input.showClock ?? true,
    enableAltTab: false,
    enablePrintScreen: false,
    enableScreenCapture: false,
    sendBrowserExamKey: true,
    // The exam URL carries a generated config key so SEB can verify the config.
    hashedQuitPassword: '',
  };
}
