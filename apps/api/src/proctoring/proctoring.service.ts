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

import type { ProctorEventRecord, ProctorEventRepository } from '../common/ports';

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

/** A validation guard for client-supplied event types (never trust the wire). */
export function isProctorEventType(value: unknown): value is ProctorEventType {
  return typeof value === 'string' && value in WEIGHTS;
}

/**
 * Persists integrity events and aggregates them per attempt.
 *
 * Kept separate from the pure `summarizeEvents` so the scoring stays trivially
 * testable while the storage dependency lives here. Reads are scoped by the
 * caller: an instructor may only see events for attempts they own the cohort of.
 */
export class ProctoringService {
  constructor(private readonly events: ProctorEventRepository) {}

  /** Record one client-reported event. Unknown types are rejected upstream. */
  async record(
    attemptId: string,
    type: ProctorEventType,
    detail?: string,
  ): Promise<ProctorEventRecord> {
    return this.events.record({ attemptId, type, payload: detail ?? null });
  }

  /** The risk summary for a single attempt. */
  async summarize(attemptId: string): Promise<ProctorSummary> {
    const rows = await this.events.listByAttempt(attemptId);
    return summarizeEvents(attemptId, toEvents(rows));
  }

  /** Risk summaries for many attempts at once (the instructor integrity view). */
  async summarizeMany(attemptIds: string[]): Promise<ProctorSummary[]> {
    const rows = await this.events.listByAttempts(attemptIds);
    return attemptIds.map((id) =>
      summarizeEvents(
        id,
        toEvents(rows.filter((r) => r.attemptId === id)),
      ),
    );
  }
}

function toEvents(rows: ProctorEventRecord[]): ProctorEvent[] {
  return rows.map((r) => ({
    attemptId: r.attemptId,
    type: r.type as ProctorEventType,
    at: r.createdAt.toISOString(),
    detail: r.payload ?? undefined,
  }));
}
