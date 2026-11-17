import type {
  ClarityAttemptRecord,
  ClarityAttemptRepository,
  UserRepository,
} from '../common/ports';
import type { ClarityEvaluator } from '../ai/ai-bridge.client';
import {
  clarityTasksFor,
  findClarityTask,
  type ClarityTask,
} from './clarity-tasks';

/** One scored Clarity attempt, as the web client renders it. */
export interface ClarityAttemptView {
  id: string;
  taskId: string;
  taskTitle: string;
  skill: string;
  response: string;
  score: number;
  band: string;
  grammar: number;
  vocabulary: number;
  content: number;
  fluency: number;
  createdAt: string;
}

/** A student's current level in one skill, derived from their history. */
export interface ClaritySkillLevel {
  skill: string;
  /** The CEFR band of their best attempt, or null before any attempt. */
  band: string | null;
  /** Their best score in the skill, or null. */
  bestScore: number | null;
  /** How many attempts they have made in the skill. */
  attempts: number;
  /** The band of their most recent attempt, so progress is visible. */
  latestBand: string | null;
}

/** One student's row in the faculty roster. */
export interface ClarityRosterRow {
  userId: string;
  fullName: string;
  email: string;
  /** Their overall CEFR band (best across skills), or null. */
  overallBand: string | null;
  /** Best score per skill, keyed by skill name. */
  bestBySkill: Record<string, number | null>;
  attempts: number;
  lastActivityAt: string | null;
}

/** Max response length, so one answer cannot store an unbounded blob. */
export const CLARITY_RESPONSE_MAX = 8000;

export interface ClarityDeps {
  attempts: ClarityAttemptRepository;
  users: UserRepository;
  /** Null when the AI plane is not configured; scoring then degrades offline. */
  evaluator: ClarityEvaluator | null;
}

/**
 * Clarity — CEFR-graded English practice (parity §2.10). A student practises one
 * of four skills (reading, writing, listening, speaking); the response is graded
 * by the AI plane, mapped to a CEFR band (A1-C2), and stored. A student's level
 * per skill is derived from their attempt history, and faculty see a roster of
 * every student's band.
 *
 * When the AI plane is unavailable the service scores with a small local
 * heuristic so the surface still works offline; the local score is deterministic
 * and mirrors the plane's own rules at a coarser grain.
 */
export class ClarityService {
  constructor(private readonly deps: ClarityDeps) {}

  /** The task bank, optionally filtered to one skill. */
  tasks(skill?: string): ClarityTask[] {
    return clarityTasksFor(skill);
  }

  /** The caller's attempts, newest first. */
  async history(userId: string): Promise<ClarityAttemptView[]> {
    const rows = await this.deps.attempts.listByUser(userId);
    return rows.map(toView);
  }

  /**
   * A student's level per skill. Each skill reports the best band they have
   * reached and their latest band, so both the ceiling and the trend show.
   */
  async levels(userId: string): Promise<ClaritySkillLevel[]> {
    const rows = await this.deps.attempts.listByUser(userId);
    return buildLevels(rows);
  }

  /**
   * Score one response and persist the attempt. An unknown task or an empty
   * response is refused; an over-long response is refused so the store stays
   * bounded.
   */
  async submit(
    userId: string,
    tenantId: string,
    taskId: string,
    response: string,
  ): Promise<
    | { ok: true; attempt: ClarityAttemptView }
    | { ok: false; reason: 'unknown_task' | 'empty' | 'too_long' }
  > {
    const task = findClarityTask(taskId);
    if (!task) return { ok: false, reason: 'unknown_task' };

    const text = response.trim();
    if (!text) return { ok: false, reason: 'empty' };
    if (text.length > CLARITY_RESPONSE_MAX) return { ok: false, reason: 'too_long' };

    const report = await this.score(userId, tenantId, task, text);
    const row = await this.deps.attempts.create({
      tenantId,
      userId,
      taskId: task.id,
      taskTitle: task.title,
      skill: report.skill,
      response: text,
      score: report.score,
      band: report.band,
      grammar: report.grammar,
      vocabulary: report.vocabulary,
      content: report.content,
      fluency: report.fluency,
    });
    return { ok: true, attempt: toView(row) };
  }

  /** The faculty roster: every student who has practised, with their bands. */
  async roster(tenantId: string): Promise<ClarityRosterRow[]> {
    const rows = await this.deps.attempts.listByTenant(tenantId);
    const byUser = new Map<string, ClarityAttemptRecord[]>();
    for (const row of rows) {
      const list = byUser.get(row.userId) ?? [];
      list.push(row);
      byUser.set(row.userId, list);
    }

    const out: ClarityRosterRow[] = [];
    for (const [userId, attempts] of byUser) {
      const user = await this.deps.users.findById(userId);
      const bestBySkill: Record<string, number | null> = {};
      let overall: number | null = null;
      let lastActivity: Date | null = null;
      for (const skill of ['reading', 'writing', 'listening', 'speaking']) {
        const inSkill = attempts.filter((a) => a.skill === skill);
        const best = inSkill.length
          ? Math.max(...inSkill.map((a) => a.score))
          : null;
        bestBySkill[skill] = best;
        if (best != null && (overall == null || best > overall)) overall = best;
      }
      for (const a of attempts) {
        if (!lastActivity || a.createdAt > lastActivity) lastActivity = a.createdAt;
      }
      out.push({
        userId,
        fullName: user?.fullName ?? userId,
        email: user?.email ?? '',
        overallBand: overall == null ? null : cefrBand(overall),
        bestBySkill,
        attempts: attempts.length,
        lastActivityAt: lastActivity ? lastActivity.toISOString() : null,
      });
    }

    // Highest overall band first, then most active — the order faculty scan.
    return out.sort((a, b) => {
      const ba = bandRank(a.overallBand);
      const bb = bandRank(b.overallBand);
      if (ba !== bb) return bb - ba;
      return b.attempts - a.attempts;
    });
  }

  private async score(
    userId: string,
    tenantId: string,
    task: ClarityTask,
    response: string,
  ): Promise<{
    skill: string;
    score: number;
    band: string;
    grammar: number;
    vocabulary: number;
    content: number;
    fluency: number;
  }> {
    if (this.deps.evaluator) {
      try {
        return await this.deps.evaluator.evaluateClarity({
          tenantId,
          studentId: userId,
          taskId: task.id,
          skill: task.skill,
          response,
          expectedTerms: task.expectedTerms,
        });
      } catch {
        // fall through to the local heuristic
      }
    }
    return localClarityScore(task.skill, response, task.expectedTerms);
  }
}

const CEFR_BANDS: Array<[string, number]> = [
  ['A1', 24],
  ['A2', 39],
  ['B1', 54],
  ['B2', 69],
  ['C1', 84],
  ['C2', 100],
];

/** Map a 0-100 score to a CEFR band (A1-C2). */
export function cefrBand(score: number): string {
  for (const [name, upper] of CEFR_BANDS) {
    if (score <= upper) return name;
  }
  return 'C2';
}

function bandRank(band: string | null): number {
  const index = CEFR_BANDS.findIndex(([name]) => name === band);
  return index < 0 ? -1 : index;
}

/** Skill weights, mirroring the AI plane's `clarity.py`. */
const WEIGHTS: Record<string, Record<string, number>> = {
  reading: { content: 0.5, vocabulary: 0.2, grammar: 0.15, fluency: 0.15 },
  writing: { content: 0.3, vocabulary: 0.25, grammar: 0.3, fluency: 0.15 },
  listening: { content: 0.5, vocabulary: 0.2, grammar: 0.15, fluency: 0.15 },
  speaking: { content: 0.3, vocabulary: 0.2, grammar: 0.2, fluency: 0.3 },
};

const FILLERS = ['um', 'uh', 'erm', 'like', 'basically', 'actually', 'literally'];

/**
 * A coarse, deterministic Clarity score used when the AI plane is unavailable.
 * It mirrors `clarity.py`'s shape (grammar / vocabulary / content / fluency and
 * the CEFR band) at a lower fidelity so the surface still works offline.
 */
export function localClarityScore(
  skill: string,
  response: string,
  expectedTerms: string[],
): {
  skill: string;
  score: number;
  band: string;
  grammar: number;
  vocabulary: number;
  content: number;
  fluency: number;
} {
  const key = WEIGHTS[skill] ? skill : 'writing';
  const weights = WEIGHTS[key]!;
  const lowered = response.toLowerCase();
  const words = lowered.match(/[a-z']+/g) ?? [];
  const n = Math.max(words.length, 1);
  const sentences = response.split(/[.!?]+/).filter((s) => s.trim().length > 0);

  let grammar = 100;
  const avgLen = words.length / Math.max(sentences.length, 1);
  if (avgLen > 40) grammar -= 20;
  if (response && response[0] !== response[0]!.toUpperCase()) grammar -= 10;
  if (sentences.length === 0) grammar = 40;
  grammar = clamp(grammar);

  const distinct = new Set(words).size;
  const vocabulary = clamp(Math.round(60 + 40 * (distinct / n)));

  let content: number;
  if (expectedTerms.length) {
    const matched = expectedTerms.filter((t) => lowered.includes(t.toLowerCase()));
    content = clamp(Math.round((matched.length / expectedTerms.length) * 100));
  } else {
    content = clamp(words.length * 5);
  }

  let fluency: number;
  if (key === 'speaking' || key === 'listening') {
    const fillerHits = FILLERS.reduce(
      (sum, f) => sum + (lowered.match(new RegExp(`\\b${f}\\b`, 'g'))?.length ?? 0),
      0,
    );
    fluency = clamp(100 - Math.round((fillerHits / n) * 100) * 3);
  } else {
    fluency = clamp(sentences.length * 40);
  }

  const score = clamp(
    Math.round(
      weights.content! * content
        + weights.vocabulary! * vocabulary
        + weights.grammar! * grammar
        + weights.fluency! * fluency,
    ),
  );

  return { skill: key, score, band: cefrBand(score), grammar, vocabulary, content, fluency };
}

function clamp(n: number): number {
  return Math.min(100, Math.max(0, n));
}

function buildLevels(rows: ClarityAttemptRecord[]): ClaritySkillLevel[] {
  return ['reading', 'writing', 'listening', 'speaking'].map((skill) => {
    const inSkill = rows.filter((r) => r.skill === skill);
    if (inSkill.length === 0) {
      return { skill, band: null, bestScore: null, attempts: 0, latestBand: null };
    }
    const best = Math.max(...inSkill.map((r) => r.score));
    // `rows` is newest-first, so the first in-skill row is the latest.
    const latest = inSkill[0]!;
    return {
      skill,
      band: cefrBand(best),
      bestScore: best,
      attempts: inSkill.length,
      latestBand: latest.band,
    };
  });
}

function toView(row: ClarityAttemptRecord): ClarityAttemptView {
  return {
    id: row.id,
    taskId: row.taskId,
    taskTitle: row.taskTitle,
    skill: row.skill,
    response: row.response,
    score: row.score,
    band: row.band,
    grammar: row.grammar,
    vocabulary: row.vocabulary,
    content: row.content,
    fluency: row.fluency,
    createdAt: row.createdAt.toISOString(),
  };
}
