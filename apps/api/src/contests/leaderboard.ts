/**
 * Contest leaderboard: a fast, rebuildable ranking index beside the durable
 * contest entries.
 *
 * The Postgres entry table is the source of truth (a contest's scores must
 * survive a Redis flush), but a live contest re-reads its standings on every
 * poll, so the ranking is served from an index that is updated in the same
 * breath as the entry write. Two implementations satisfy `LeaderboardPort`:
 * `InMemoryLeaderboard` (tests, single process) and `RedisLeaderboard` (a
 * sorted set, so a leaderboard read is one `ZREVRANGE` rather than a sort).
 *
 * Ordering is by score descending, then fastest completion (ADR-G1): a tie on
 * score is broken by the shorter duration, and a further tie by the earlier
 * submission, so the order is total and stable.
 */

/** One ranked entry, as stored in the index. Names are resolved by the service. */
export interface LeaderboardEntry {
  userId: string;
  score: number;
  /** Milliseconds from contest start to this score; the tie-break. */
  durationMs: number;
  submittedAt: Date;
}

/** The ranking index a `ContestService` reads and writes. */
export interface LeaderboardPort {
  /**
   * Record a score, keeping only the student's best (highest score, then
   * fastest). Idempotent: replaying the same entry is a no-op.
   */
  record(contestId: string, entry: LeaderboardEntry): Promise<void>;
  /** The top `limit` entries, best first. */
  top(contestId: string, limit?: number): Promise<LeaderboardEntry[]>;
  /** One student's entry, or null when they have not scored. */
  find(contestId: string, userId: string): Promise<LeaderboardEntry | null>;
  /** Drop a contest's index (used when a contest is deleted or rebuilt). */
  clear(contestId: string): Promise<void>;
}

/**
 * Whether `candidate` should replace `current` as a student's best entry.
 * A higher score always wins; an equal score is beaten by a faster time; an
 * exact tie keeps the earlier submission (so a replay cannot reorder).
 */
export function beats(current: LeaderboardEntry, candidate: LeaderboardEntry): boolean {
  if (candidate.score !== current.score) return candidate.score > current.score;
  if (candidate.durationMs !== current.durationMs) {
    return candidate.durationMs < current.durationMs;
  }
  return candidate.submittedAt.getTime() < current.submittedAt.getTime();
}

/** Sort entries best-first: score desc, duration asc, submittedAt asc. */
export function rankEntries(entries: LeaderboardEntry[]): LeaderboardEntry[] {
  return [...entries].sort(
    (a, b) =>
      b.score - a.score ||
      a.durationMs - b.durationMs ||
      a.submittedAt.getTime() - b.submittedAt.getTime() ||
      a.userId.localeCompare(b.userId),
  );
}

/** In-memory ranking index; the same ordering the Redis sorted set produces. */
export class InMemoryLeaderboard implements LeaderboardPort {
  /** contestId -> (userId -> best entry). */
  private readonly boards = new Map<string, Map<string, LeaderboardEntry>>();

  async record(contestId: string, entry: LeaderboardEntry): Promise<void> {
    const board = this.boards.get(contestId) ?? new Map<string, LeaderboardEntry>();
    const current = board.get(entry.userId);
    if (!current || beats(current, entry)) board.set(entry.userId, entry);
    this.boards.set(contestId, board);
  }

  async top(contestId: string, limit = 100): Promise<LeaderboardEntry[]> {
    const board = this.boards.get(contestId);
    if (!board) return [];
    return rankEntries([...board.values()]).slice(0, limit);
  }

  async find(contestId: string, userId: string): Promise<LeaderboardEntry | null> {
    return this.boards.get(contestId)?.get(userId) ?? null;
  }

  async clear(contestId: string): Promise<void> {
    this.boards.delete(contestId);
  }
}
