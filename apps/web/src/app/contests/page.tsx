'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  api,
  ApiError,
  type Contest,
  type LeaderboardRow,
  type Session,
} from '@/lib/api';
import { contestIsLive, contestPhaseLabel, durationLabel } from '@/lib/lms';

/**
 * Contests — timed sprints with a live leaderboard (ByteXL parity §2.8, Phase G).
 *
 * A student sees published contests, opens one to watch the standings, and
 * enters a score while the contest is live. Instructors and admins additionally
 * author and publish contests. The contest phase (scheduled / live / ended) is
 * derived by the API from the contest window, so the page never needs a timer to
 * know whether a contest is open.
 */
export default function ContestsPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [contests, setContests] = useState<Contest[] | null>(null);
  const [selected, setSelected] = useState<Contest | null>(null);
  const [error, setError] = useState<string | null>(null);

  const staff = session?.role === 'instructor' || session?.role === 'admin';

  const loadContests = useCallback(async () => {
    setError(null);
    try {
      setContests(await api.contests());
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 401
          ? 'Sign in to view contests.'
          : 'Could not load contests.',
      );
    }
  }, []);

  useEffect(() => {
    api
      .session()
      .then(setSession)
      .catch(() => setSession(null))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (loaded && session) void loadContests();
  }, [loaded, session, loadContests]);

  if (!loaded) return <p className="muted">Loading contests…</p>;
  if (!session) return <p className="error">Please sign in to view contests.</p>;

  return (
    <div>
      <h1>Contests</h1>
      <p className="muted" style={{ maxWidth: 640 }}>
        Timed sprints that score your lab work and rank the field on a live
        leaderboard. Enter while a contest is live; the fastest completion breaks
        a tie.
      </p>

      {error ? <p className="error">{error}</p> : null}

      {staff ? <NewContest onCreated={loadContests} /> : null}

      <div className="row" style={{ gap: 32, alignItems: 'flex-start', marginTop: 16 }}>
        <div style={{ flex: 1, minWidth: 280 }}>
          <h3>Open contests</h3>
          {contests === null ? <p className="muted">Loading…</p> : null}
          {contests && contests.length === 0 ? (
            <p className="muted">No contests yet.</p>
          ) : null}
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {contests?.map((contest) => (
              <li key={contest.id} className="card" style={{ marginBottom: 8 }}>
                <div className="row" style={{ alignItems: 'baseline' }}>
                  <strong>{contest.title}</strong>
                  <span className={`pill phase-${contest.phase}`} style={{ marginLeft: 'auto' }}>
                    {contestPhaseLabel(contest.phase)}
                  </span>
                </div>
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                  {contest.entrants} entrant{contest.entrants === 1 ? '' : 's'} · max{' '}
                  {contest.maxScore}
                  {contest.exerciseSlug ? ` · lab ${contest.exerciseSlug}` : ''}
                </div>
                <div className="row" style={{ marginTop: 8, gap: 8 }}>
                  <button onClick={() => setSelected(contest)}>Leaderboard</button>
                  {staff && contest.status === 'draft' ? (
                    <button
                      onClick={async () => {
                        await api.publishContest(contest.id);
                        await loadContests();
                      }}
                    >
                      Publish
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div style={{ flex: 2, minWidth: 320 }}>
          {selected ? (
            <ContestDetail
              contest={selected}
              onEntered={loadContests}
            />
          ) : (
            <p className="muted">Pick a contest to see its leaderboard.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function ContestDetail({
  contest,
  onEntered,
}: {
  contest: Contest;
  onEntered: () => void;
}) {
  const [rows, setRows] = useState<LeaderboardRow[] | null>(null);
  const [mine, setMine] = useState<LeaderboardRow | null>(null);
  const [score, setScore] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setRows(await api.contestLeaderboard(contest.id));
      setMine(await api.myContestStanding(contest.id));
    } catch {
      setError('Could not load the leaderboard.');
    }
  }, [contest.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const enter = async () => {
    const parsed = Number(score);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > contest.maxScore) {
      setError(`Enter a score between 0 and ${contest.maxScore}.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.submitContestEntry(contest.id, { score: parsed });
      setScore('');
      await load();
      onEntered();
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 400
          ? 'This contest is not open for entries right now.'
          : 'Could not file your entry.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <h2 style={{ marginBottom: 4 }}>{contest.title}</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        {contest.description || 'No description.'}
      </p>

      {contestIsLive(contest.phase) ? (
        <div className="card">
          <div className="row" style={{ gap: 12, alignItems: 'flex-end' }}>
            <label>
              <div className="muted" style={{ fontSize: 12 }}>
                Your score (0–{contest.maxScore})
              </div>
              <input
                value={score}
                onChange={(e) => setScore(e.target.value)}
                inputMode="numeric"
                placeholder="e.g. 85"
              />
            </label>
            <button onClick={() => void enter()} disabled={busy}>
              {mine ? 'Improve score' : 'Enter contest'}
            </button>
          </div>
          {mine ? (
            <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>
              Your best: {mine.score} at rank #{mine.rank} ({durationLabel(mine.durationMs)})
            </p>
          ) : null}
        </div>
      ) : (
        <p className="muted">Entries are closed ({contestPhaseLabel(contest.phase)}).</p>
      )}

      {error ? <p className="error">{error}</p> : null}

      {rows === null ? <p className="muted">Loading leaderboard…</p> : null}
      {rows && rows.length === 0 ? (
        <p className="muted">No entries yet. Be the first.</p>
      ) : null}
      {rows && rows.length > 0 ? (
        <table className="gradebook" style={{ marginTop: 8 }}>
          <thead>
            <tr>
              <th>#</th>
              <th>Student</th>
              <th>Score</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.userId}
                style={row.isSelf ? { fontWeight: 600 } : undefined}
              >
                <td>{row.rank}</td>
                <td>
                  {row.displayName}
                  {row.isSelf ? ' (you)' : ''}
                </td>
                <td>{row.score}</td>
                <td>{durationLabel(row.durationMs)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}

function NewContest({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [exerciseSlug, setExerciseSlug] = useState('');
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    if (!title.trim()) {
      setError('A title is required.');
      return;
    }
    setError(null);
    try {
      await api.createContest({
        title: title.trim(),
        exerciseSlug: exerciseSlug.trim() || null,
        startAt: startAt ? new Date(startAt).toISOString() : null,
        endAt: endAt ? new Date(endAt).toISOString() : null,
      });
      setTitle('');
      setExerciseSlug('');
      setStartAt('');
      setEndAt('');
      setOpen(false);
      onCreated();
    } catch {
      setError('Could not create the contest.');
    }
  };

  if (!open) {
    return (
      <div style={{ marginTop: 16 }}>
        <button onClick={() => setOpen(true)}>New contest</button>
      </div>
    );
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h3 style={{ marginTop: 0 }}>New contest</h3>
      <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label>
          <div className="muted" style={{ fontSize: 12 }}>
            Title
          </div>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Sprint" />
        </label>
        <label>
          <div className="muted" style={{ fontSize: 12 }}>
            Lab slug (optional)
          </div>
          <input
            value={exerciseSlug}
            onChange={(e) => setExerciseSlug(e.target.value)}
            placeholder="create-simple-pod"
          />
        </label>
        <label>
          <div className="muted" style={{ fontSize: 12 }}>
            Starts
          </div>
          <input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
        </label>
        <label>
          <div className="muted" style={{ fontSize: 12 }}>
            Ends
          </div>
          <input type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
        </label>
        <button onClick={() => void create()}>Create draft</button>
        <button onClick={() => setOpen(false)}>Cancel</button>
      </div>
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}
