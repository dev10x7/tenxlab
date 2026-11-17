import type { ContestPhase } from '@tenxlab/contracts';
import type {
  ContestEntryRecord,
  ContestEntryRepository,
  ContestRecord,
  ContestRepository,
  UserRepository,
} from '../common/ports';
import type { LeaderboardPort } from './leaderboard';
import { rankEntries } from './leaderboard';

/** A contest as the web client renders it, with its derived phase. */
export interface ContestView {
  id: string;
  title: string;
  description: string;
  status: string;
  phase: ContestPhase;
  startAt: string | null;
  endAt: string | null;
  maxScore: number;
  exerciseSlug: string | null;
  /** How many students have a standing. */
  entrants: number;
}

/** One leaderboard row, ranked and with the author's name resolved. */
export interface LeaderboardRowView {
  rank: number;
  userId: string;
  displayName: string;
  score: number;
  durationMs: number;
  isSelf: boolean;
}

export interface ContestDeps {
  contests: ContestRepository;
  entries: ContestEntryRepository;
  leaderboard: LeaderboardPort;
  users: UserRepository;
  /** Injected so the phase gate is testable without the wall clock. */
  now?: () => Date;
}

export type CreateContestInput = {
  tenantId: string;
  createdBy: string;
  title: string;
  description?: string;
  startAt?: Date | null;
  endAt?: Date | null;
  maxScore?: number;
  exerciseSlug?: string | null;
};

export type ContestFailure =
  | 'not_found'
  | 'title_required'
  | 'not_published'
  | 'not_live'
  | 'score_out_of_range'
  | 'invalid_window';

const DEFAULT_MAX_SCORE = 100;

/**
 * Contest lifecycle + leaderboard (parity §2.8, Phase G).
 *
 * A contest is authored (draft) then published; the phase a student sees
 * (scheduled/live/ended) is *derived from the window on read*, so a contest
 * cannot be left open past its end time by a missed job. Scores are recorded as
 * durable entries (the source of truth) and mirrored into a ranking index
 * (`LeaderboardPort`) that a live contest reads on every poll — so a leaderboard
 * read is fast and can be rebuilt from the entries if the index is lost.
 *
 * Ordering (ADR-G1): highest score wins; a tie is broken by the fastest
 * completion (shorter duration); a further tie keeps the earlier submission.
 */
export class ContestService {
  private readonly now: () => Date;

  constructor(private readonly deps: ContestDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  /** Author a contest. Starts as a draft until published. */
  async create(input: CreateContestInput): Promise<
    { ok: true; contest: ContestRecord } | { ok: false; reason: ContestFailure }
  > {
    const title = input.title?.trim();
    if (!title) return { ok: false, reason: 'title_required' };
    if (
      input.startAt &&
      input.endAt &&
      input.endAt.getTime() <= input.startAt.getTime()
    ) {
      return { ok: false, reason: 'invalid_window' };
    }
    const contest = await this.deps.contests.create({
      tenantId: input.tenantId,
      title,
      description: input.description?.trim() ?? '',
      status: 'draft',
      startAt: input.startAt ?? null,
      endAt: input.endAt ?? null,
      maxScore: input.maxScore && input.maxScore > 0 ? input.maxScore : DEFAULT_MAX_SCORE,
      exerciseSlug: input.exerciseSlug ?? null,
      createdBy: input.createdBy,
    });
    return { ok: true, contest };
  }

  /** Publish a draft (or re-publish an unpublished contest). */
  async publish(
    id: string,
    tenantId: string,
  ): Promise<{ ok: true; contest: ContestRecord } | { ok: false; reason: ContestFailure }> {
    const contest = await this.requireContest(id, tenantId);
    if (!contest) return { ok: false, reason: 'not_found' };
    const updated = await this.deps.contests.update(id, { status: 'published' });
    return { ok: true, contest: updated };
  }

  /** Contests a viewer may see: students get published only, staff get all. */
  async list(
    tenantId: string,
    options: { includeDrafts?: boolean } = {},
  ): Promise<ContestView[]> {
    const rows = await this.deps.contests.listByTenant(tenantId);
    const visible = options.includeDrafts
      ? rows
      : rows.filter((row) => row.status === 'published');
    return Promise.all(visible.map((row) => this.toView(row)));
  }

  /** One contest's detail, tenant-scoped. */
  async get(id: string, tenantId: string): Promise<ContestView | null> {
    const contest = await this.requireContest(id, tenantId);
    return contest ? this.toView(contest) : null;
  }

  /**
   * The live standings. Served from the ranking index; if the index is empty
   * (a Redis flush) it is rebuilt from the durable entries, so a leaderboard is
   * never wrong — only briefly slower.
   */
  async leaderboard(
    id: string,
    tenantId: string,
    callerId: string,
    limit = 100,
  ): Promise<LeaderboardRowView[] | null> {
    const contest = await this.requireContest(id, tenantId);
    if (!contest) return null;
    let entries = await this.deps.leaderboard.top(id, limit);
    if (entries.length === 0) {
      entries = await this.rebuild(contest);
    }
    const names = await this.nameMap(entries.map((e) => e.userId));
    return entries.slice(0, limit).map((entry, index) => ({
      rank: index + 1,
      userId: entry.userId,
      displayName: names.get(entry.userId) ?? entry.userId,
      score: entry.score,
      durationMs: entry.durationMs,
      isSelf: entry.userId === callerId,
    }));
  }

  /**
   * Record a student's completion against any live contest it qualifies for.
   * Called from the gradebook webhook, so it must be fast (one write + one
   * index update) and must never throw on a contest it does not match.
   */
  async recordCompletion(input: {
    tenantId: string;
    userId: string;
    exerciseSlug: string;
    score: number;
    completedAt: Date;
    durationMs?: number;
  }): Promise<void> {
    const contests = await this.deps.contests.listByTenant(input.tenantId);
    const matching = contests.filter(
      (contest) =>
        contest.status === 'published' &&
        this.phase(contest) === 'live' &&
        (contest.exerciseSlug === null || contest.exerciseSlug === input.exerciseSlug),
    );
    for (const contest of matching) {
      const score = Math.min(Math.max(Math.round(input.score), 0), contest.maxScore);
      const durationMs =
        input.durationMs ?? this.deriveDuration(contest, input.completedAt);
      await this.record(contest, input.userId, score, durationMs, input.completedAt);
    }
  }

  /**
   * Enter a contest (records a zero score so the student appears on the board)
   * or submit a score for it. A contest that is not live is refused, so scores
   * cannot be filed before it opens or after it ends.
   */
  async submitEntry(input: {
    contestId: string;
    tenantId: string;
    userId: string;
    score: number;
    durationMs?: number;
  }): Promise<{ ok: true; row: LeaderboardRowView } | { ok: false; reason: ContestFailure }> {
    const contest = await this.requireContest(input.contestId, input.tenantId);
    if (!contest) return { ok: false, reason: 'not_found' };
    if (contest.status !== 'published') return { ok: false, reason: 'not_published' };
    if (this.phase(contest) !== 'live') return { ok: false, reason: 'not_live' };
    if (input.score < 0 || input.score > contest.maxScore) {
      return { ok: false, reason: 'score_out_of_range' };
    }
    const at = this.now();
    const durationMs = input.durationMs ?? this.deriveDuration(contest, at);
    await this.record(contest, input.userId, Math.round(input.score), durationMs, at);
    const row = await this.rowFor(contest.id, input.userId, input.userId);
    return { ok: true, row: row ?? { rank: 1, userId: input.userId, displayName: input.userId, score: 0, durationMs, isSelf: true } };
  }

  /** A student's own standing, or null when they have not entered. */
  async myStanding(
    id: string,
    tenantId: string,
    userId: string,
  ): Promise<LeaderboardRowView | null> {
    const contest = await this.requireContest(id, tenantId);
    if (!contest) return null;
    return this.rowFor(id, userId, userId);
  }

  /** The student's best rank across every contest they have entered. */
  async bestRank(userId: string): Promise<number | null> {
    const entries = await this.deps.entries.listByUser(userId);
    let best: number | null = null;
    const seen = new Set<string>();
    for (const entry of entries) {
      if (seen.has(entry.contestId)) continue;
      seen.add(entry.contestId);
      const rows = await this.deps.entries.listByContest(entry.contestId);
      const ranked = rankEntries(
        rows.map((r) => ({
          userId: r.userId,
          score: r.score,
          durationMs: r.durationMs,
          submittedAt: r.submittedAt,
        })),
      );
      const index = ranked.findIndex((r) => r.userId === userId);
      if (index >= 0) best = best === null ? index + 1 : Math.min(best, index + 1);
    }
    return best;
  }

  // ---------------------------------------------------------------- internals

  private async record(
    contest: ContestRecord,
    userId: string,
    score: number,
    durationMs: number,
    submittedAt: Date,
  ): Promise<void> {
    const entry = await this.deps.entries.upsertBest({
      contestId: contest.id,
      tenantId: contest.tenantId,
      userId,
      score,
      durationMs,
      submittedAt,
    });
    await this.deps.leaderboard.record(contest.id, {
      userId,
      score: entry.score,
      durationMs: entry.durationMs,
      submittedAt: entry.submittedAt,
    });
  }

  /** Rebuild a contest's index from its durable entries; returns the entries. */
  private async rebuild(contest: ContestRecord) {
    const rows = await this.deps.entries.listByContest(contest.id);
    const ranked = rankEntries(
      rows.map((r) => ({
        userId: r.userId,
        score: r.score,
        durationMs: r.durationMs,
        submittedAt: r.submittedAt,
      })),
    );
    for (const entry of ranked) {
      await this.deps.leaderboard.record(contest.id, entry);
    }
    return ranked;
  }

  private async rowFor(
    contestId: string,
    userId: string,
    callerId: string,
  ): Promise<LeaderboardRowView | null> {
    const top = await this.deps.leaderboard.top(contestId, 1000);
    let ranked = top;
    if (ranked.length === 0) {
      const rows = await this.deps.entries.listByContest(contestId);
      ranked = rankEntries(
        rows.map((r) => ({
          userId: r.userId,
          score: r.score,
          durationMs: r.durationMs,
          submittedAt: r.submittedAt,
        })),
      );
    }
    const index = ranked.findIndex((r) => r.userId === userId);
    if (index < 0) return null;
    const entry = ranked[index];
    if (!entry) return null;
    const names = await this.nameMap([userId]);
    return {
      rank: index + 1,
      userId,
      displayName: names.get(userId) ?? userId,
      score: entry.score,
      durationMs: entry.durationMs,
      isSelf: userId === callerId,
    };
  }

  private async nameMap(userIds: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(userIds)];
    const pairs = await Promise.all(
      unique.map(async (id) => {
        const user = await this.deps.users.findById(id);
        return [id, user?.fullName ?? id] as const;
      }),
    );
    return new Map(pairs);
  }

  /** Duration from the contest's start (or the entry time) to `at`. */
  private deriveDuration(contest: ContestRecord, at: Date): number {
    const start = contest.startAt ?? at;
    return Math.max(at.getTime() - start.getTime(), 0);
  }

  /** Derive the phase from the window; never stored, so it cannot go stale. */
  phase(contest: ContestRecord, at: Date = this.now()): ContestPhase {
    if (contest.status !== 'published') return 'draft';
    if (contest.startAt && contest.startAt.getTime() > at.getTime()) return 'scheduled';
    if (contest.endAt && contest.endAt.getTime() <= at.getTime()) return 'ended';
    return 'live';
  }

  private async requireContest(
    id: string,
    tenantId: string,
  ): Promise<ContestRecord | null> {
    const contest = await this.deps.contests.findById(id);
    if (!contest || contest.tenantId !== tenantId) return null;
    return contest;
  }

  private async toView(contest: ContestRecord): Promise<ContestView> {
    const entries = await this.deps.entries.listByContest(contest.id);
    return {
      id: contest.id,
      title: contest.title,
      description: contest.description,
      status: contest.status,
      phase: this.phase(contest),
      startAt: contest.startAt?.toISOString() ?? null,
      endAt: contest.endAt?.toISOString() ?? null,
      maxScore: contest.maxScore,
      exerciseSlug: contest.exerciseSlug,
      entrants: entries.length,
    };
  }
}
