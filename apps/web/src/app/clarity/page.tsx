'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  api,
  ApiError,
  type ClarityAttempt,
  type ClarityRosterRow,
  type ClaritySkillLevel,
  type ClarityTask,
  type Session,
} from '@/lib/api';
import { cefrBandLabel, claritySkillLabel, scoreLabel } from '@/lib/lms';

/**
 * Clarity — CEFR-graded English practice (ByteXL parity §2.10).
 *
 * A student picks a skill (reading, writing, listening, speaking), practises a
 * task, and submits a response. The response is graded by the AI plane and
 * placed on the CEFR scale (A1-C2). The page shows the student's level per
 * skill and their attempt history. Faculty additionally see a roster of every
 * student's band, so a class's communication readiness is visible at a glance.
 *
 * Listening tasks read their passage aloud with the browser's speech synthesis,
 * so the student hears the text before answering — the practice is listening,
 * not reading.
 */
export default function ClarityPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [tasks, setTasks] = useState<ClarityTask[]>([]);
  const [levels, setLevels] = useState<ClaritySkillLevel[]>([]);
  const [history, setHistory] = useState<ClarityAttempt[]>([]);
  const [roster, setRoster] = useState<ClarityRosterRow[] | null>(null);
  const [skill, setSkill] = useState<string>('reading');
  const [selected, setSelected] = useState<string | null>(null);
  const [response, setResponse] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const staff = session?.role === 'instructor' || session?.role === 'admin';

  const loadStudent = useCallback(async () => {
    const [bank, myLevels, myHistory] = await Promise.all([
      api.clarityTasks(),
      api.clarityLevels(),
      api.clarityHistory(),
    ]);
    setTasks(bank);
    setLevels(myLevels);
    setHistory(myHistory);
    setSelected((prev) => prev ?? bank[0]?.id ?? null);
  }, []);

  useEffect(() => {
    api
      .session()
      .then(setSession)
      .catch(() => setSession(null))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (!loaded || !session) return;
    setError(null);
    loadStudent().catch(() => setError('Could not load Clarity. Please try again.'));
    if (staff) {
      api
        .clarityRoster()
        .then(setRoster)
        .catch(() => setRoster(null));
    }
  }, [loaded, session, staff, loadStudent]);

  const visible = useMemo(
    () => tasks.filter((t) => t.skill === skill),
    [tasks, skill],
  );
  const task = tasks.find((t) => t.id === selected) ?? visible[0] ?? null;

  const speak = () => {
    if (!task?.passage || typeof window === 'undefined') return;
    const synth = window.speechSynthesis;
    if (!synth) return;
    synth.cancel();
    synth.speak(new SpeechSynthesisUtterance(task.passage));
  };

  const submit = async () => {
    if (!task || !response.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const attempt = await api.submitClarity(task.id, response.trim());
      setHistory((prev) => [attempt, ...prev]);
      setResponse('');
      setLevels(await api.clarityLevels());
      if (staff) api.clarityRoster().then(setRoster).catch(() => undefined);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 400
          ? 'That response could not be scored. Please check it and try again.'
          : 'Could not score your response. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  if (!loaded) return <p className="muted">Loading Clarity…</p>;
  if (!session) return <p className="error">Please sign in to practise Clarity.</p>;

  return (
    <div>
      <h1>Clarity</h1>
      <p className="muted" style={{ maxWidth: 640 }}>
        Practise English communication and track your CEFR level (A1-C2) across
        reading, writing, listening, and speaking.
      </p>

      {error ? <p className="error">{error}</p> : null}

      <h2 style={{ marginTop: 24 }}>Your level</h2>
      <table className="gradebook">
        <thead>
          <tr>
            <th>Skill</th>
            <th>Current band</th>
            <th>Best score</th>
            <th>Attempts</th>
          </tr>
        </thead>
        <tbody>
          {levels.map((l) => (
            <tr key={l.skill}>
              <td>{claritySkillLabel(l.skill)}</td>
              <td>{cefrBandLabel(l.band)}</td>
              <td>{scoreLabel(l.bestScore)}</td>
              <td>{l.attempts}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="card" style={{ marginTop: 16 }}>
        <label>
          <div className="muted" style={{ fontSize: 12 }}>
            Skill
          </div>
          <select
            value={skill}
            onChange={(e) => {
              setSkill(e.target.value);
              setSelected(null);
            }}
          >
            {['reading', 'writing', 'listening', 'speaking'].map((s) => (
              <option key={s} value={s}>
                {claritySkillLabel(s)}
              </option>
            ))}
          </select>
        </label>

        <label>
          <div className="muted" style={{ fontSize: 12, marginTop: 12 }}>
            Task
          </div>
          <select
            value={task?.id ?? ''}
            onChange={(e) => setSelected(e.target.value)}
          >
            {visible.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        </label>

        {task ? (
          <>
            <p style={{ marginTop: 12 }}>
              <strong>{task.prompt}</strong>
            </p>
            {task.passage ? (
              <>
                <blockquote className="muted" style={{ margin: '8px 0' }}>
                  {task.passage}
                </blockquote>
                {task.skill === 'listening' ? (
                  <div className="row">
                    <button onClick={speak} type="button">
                      ▶ Play passage
                    </button>
                  </div>
                ) : null}
              </>
            ) : null}
          </>
        ) : (
          <p className="muted">No tasks in this skill yet.</p>
        )}

        <label>
          <div className="muted" style={{ fontSize: 12, marginTop: 12 }}>
            Your response
          </div>
          <textarea
            rows={6}
            style={{ width: '100%' }}
            value={response}
            onChange={(e) => setResponse(e.target.value)}
            placeholder="Write your response…"
            disabled={busy}
          />
        </label>

        <div className="row" style={{ marginTop: 8 }}>
          <button
            onClick={() => void submit()}
            disabled={busy || !task || !response.trim()}
          >
            {busy ? 'Scoring…' : 'Submit for CEFR scoring'}
          </button>
        </div>
      </div>

      <h2 style={{ marginTop: 32 }}>Your attempts</h2>
      {history.length === 0 ? (
        <p className="muted">No attempts yet. Answer a task above to start.</p>
      ) : (
        <table className="gradebook">
          <thead>
            <tr>
              <th>Task</th>
              <th>Skill</th>
              <th>Band</th>
              <th>Score</th>
              <th>Grammar</th>
              <th>Vocabulary</th>
              <th>Content</th>
              <th>Fluency</th>
            </tr>
          </thead>
          <tbody>
            {history.map((a) => (
              <tr key={a.id}>
                <td>{a.taskTitle}</td>
                <td>{claritySkillLabel(a.skill)}</td>
                <td>{a.band}</td>
                <td>{scoreLabel(a.score)}</td>
                <td>{scoreLabel(a.grammar)}</td>
                <td>{scoreLabel(a.vocabulary)}</td>
                <td>{scoreLabel(a.content)}</td>
                <td>{scoreLabel(a.fluency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {staff ? (
        <>
          <h2 style={{ marginTop: 32 }}>Cohort roster</h2>
          {roster == null ? (
            <p className="muted">Roster unavailable.</p>
          ) : roster.length === 0 ? (
            <p className="muted">No student has practised Clarity yet.</p>
          ) : (
            <table className="gradebook">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>Overall band</th>
                  <th>Reading</th>
                  <th>Writing</th>
                  <th>Listening</th>
                  <th>Speaking</th>
                  <th>Attempts</th>
                </tr>
              </thead>
              <tbody>
                {roster.map((r) => (
                  <tr key={r.userId}>
                    <td>{r.fullName}</td>
                    <td>{cefrBandLabel(r.overallBand)}</td>
                    <td>{scoreLabel(r.bestBySkill.reading ?? null)}</td>
                    <td>{scoreLabel(r.bestBySkill.writing ?? null)}</td>
                    <td>{scoreLabel(r.bestBySkill.listening ?? null)}</td>
                    <td>{scoreLabel(r.bestBySkill.speaking ?? null)}</td>
                    <td>{r.attempts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      ) : null}
    </div>
  );
}
