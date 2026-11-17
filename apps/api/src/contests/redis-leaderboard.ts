import Redis from 'ioredis';
import {
  beats,
  type LeaderboardEntry,
  type LeaderboardPort,
} from './leaderboard';

/**
 * Redis-backed leaderboard (ADR-G1): a sorted set ranks the standings and a hash
 * stores each student's best entry, so a leaderboard read is one `ZREVRANGE`
 * rather than a sort over every entry. Redis is the *index*, never the source of
 * truth — `ContestService` keeps the durable entry rows and rebuilds this index
 * from them if it is ever lost (a flush, a restart with no persistence).
 *
 * Score is the sorted-set score; the tie-break (fastest completion) is folded
 * into the same number so Redis orders ties without a secondary read:
 * `composite = score * SCORE_SCALE - durationMs`. Durations above the scale are
 * clamped, which only matters for contests longer than the scale in ms.
 */

/** Millisecond scale for the composite score; ~11.5 days of headroom. */
export const SCORE_SCALE = 1_000_000_000;

/** Encode a score + duration into one sortable number (higher is better). */
export function compositeScore(score: number, durationMs: number): number {
  const clamped = Math.min(Math.max(durationMs, 0), SCORE_SCALE - 1);
  return score * SCORE_SCALE - clamped;
}

const rankKey = (contestId: string) => `tenxlab:contest:${contestId}:rank`;
const entryKey = (contestId: string) => `tenxlab:contest:${contestId}:entries`;

export class RedisLeaderboard implements LeaderboardPort {
  private readonly client: Redis;

  constructor(url: string, client?: Redis) {
    this.client =
      client ??
      new Redis(url, {
        // A leaderboard read must not hang the request; fail fast and let the
        // service fall back to the durable entries.
        maxRetriesPerRequest: 1,
        enableOfflineQueue: true,
        lazyConnect: false,
      });
  }

  async record(contestId: string, entry: LeaderboardEntry): Promise<void> {
    const current = await this.find(contestId, entry.userId);
    if (current && !beats(current, entry)) return;
    await this.client
      .multi()
      .zadd(rankKey(contestId), compositeScore(entry.score, entry.durationMs), entry.userId)
      .hset(entryKey(contestId), entry.userId, serialise(entry))
      .exec();
  }

  async top(contestId: string, limit = 100): Promise<LeaderboardEntry[]> {
    const ids = await this.client.zrevrange(rankKey(contestId), 0, Math.max(limit - 1, 0));
    if (ids.length === 0) return [];
    const raw = await this.client.hmget(entryKey(contestId), ...ids);
    const out: LeaderboardEntry[] = [];
    ids.forEach((userId, index) => {
      const value = raw[index];
      const entry = value ? deserialise(value) : null;
      if (entry) out.push({ ...entry, userId });
    });
    return out;
  }

  async find(contestId: string, userId: string): Promise<LeaderboardEntry | null> {
    const value = await this.client.hget(entryKey(contestId), userId);
    const entry = value ? deserialise(value) : null;
    return entry ? { ...entry, userId } : null;
  }

  async clear(contestId: string): Promise<void> {
    await this.client.del(rankKey(contestId), entryKey(contestId));
  }

  /** Close the connection; used on shutdown and in tests. */
  async quit(): Promise<void> {
    await this.client.quit();
  }
}

interface SerialisedEntry {
  score: number;
  durationMs: number;
  submittedAt: string;
}

function serialise(entry: LeaderboardEntry): string {
  const payload: SerialisedEntry = {
    score: entry.score,
    durationMs: entry.durationMs,
    submittedAt: entry.submittedAt.toISOString(),
  };
  return JSON.stringify(payload);
}

function deserialise(value: string): LeaderboardEntry | null {
  try {
    const parsed = JSON.parse(value) as SerialisedEntry;
    if (typeof parsed.score !== 'number' || typeof parsed.durationMs !== 'number') {
      return null;
    }
    return {
      // The hash is keyed by userId, so it is re-attached by the caller.
      userId: '',
      score: parsed.score,
      durationMs: parsed.durationMs,
      submittedAt: new Date(parsed.submittedAt),
    };
  } catch {
    return null;
  }
}
