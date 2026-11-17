'use client';

import { useEffect, useState } from 'react';
import {
  api,
  type InterviewAttempt,
  type InterviewPrompt,
} from '@/lib/api';
import { communicationLabel, scoreLabel } from '@/lib/lms';

/**
 * AI Interviewer — mock interviews with soft-skills scoring (parity §2.6).
 *
 * The student picks a prompt, types (or dictates) an answer, and the answer is
 * scored for communication: grammar, vocabulary, filler words, and technical
 * accuracy against the prompt's expected terms. The score lands on the
 * student's Skill Passport, so a recruiter sees it alongside the lab evidence.
 */
export default function AiInterviewerPage() {
  const [prompts, setPrompts] = useState<InterviewPrompt[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [transcript, setTranscript] = useState('');
  const [history, setHistory] = useState<InterviewAttempt[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    Promise.all([api.interviewPrompts(), api.interviewHistory()])
      .then(([bank, sittings]) => {
        setPrompts(bank);
        setSelected(bank[0]?.id ?? null);
        setHistory(sittings);
      })
      .catch(() => setError('Could not load the interviewer. Please try again.'))
      .finally(() => setLoaded(true));
  }, []);

  const prompt = prompts.find((p) => p.id === selected) ?? null;

  const submit = async () => {
    if (!prompt || !transcript.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const attempt = await api.submitInterview(prompt.id, transcript.trim());
      setHistory((prev) => [attempt, ...prev]);
      setTranscript('');
    } catch {
      setError('Could not score your answer. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  if (!loaded) return <p className="muted">Loading interviewer…</p>;

  return (
    <div>
      <h1>AI Interviewer</h1>
      <p className="muted" style={{ maxWidth: 640 }}>
        Practise a mock interview. Your answer is scored for communication, and
        the score is added to your skill passport.
      </p>

      {error ? <p className="error">{error}</p> : null}

      <div className="card" style={{ marginTop: 16 }}>
        <label>
          <div className="muted" style={{ fontSize: 12 }}>
            Prompt
          </div>
          <select
            value={selected ?? ''}
            onChange={(e) => setSelected(e.target.value)}
          >
            {prompts.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
        </label>

        {prompt ? (
          <p style={{ marginTop: 12 }}>
            <strong>{prompt.question}</strong>
          </p>
        ) : null}

        <label>
          <div className="muted" style={{ fontSize: 12, marginTop: 12 }}>
            Your answer
          </div>
          <textarea
            rows={6}
            style={{ width: '100%' }}
            value={transcript}
            onChange={(e) => setTranscript(e.target.value)}
            placeholder="Type your spoken answer…"
            disabled={busy}
          />
        </label>

        <div className="row" style={{ marginTop: 8 }}>
          <button onClick={() => void submit()} disabled={busy || !transcript.trim()}>
            {busy ? 'Scoring…' : 'Submit for scoring'}
          </button>
        </div>
      </div>

      <h2 style={{ marginTop: 32 }}>Your sittings</h2>
      {history.length === 0 ? (
        <p className="muted">No sittings yet. Answer a prompt above to start.</p>
      ) : (
        <table className="gradebook">
          <thead>
            <tr>
              <th>Prompt</th>
              <th>Communication</th>
              <th>Grammar</th>
              <th>Vocabulary</th>
              <th>Fillers</th>
              <th>Technical</th>
            </tr>
          </thead>
          <tbody>
            {history.map((a) => (
              <tr key={a.id}>
                <td>{a.promptTitle}</td>
                <td>{communicationLabel(a.communicationScore)}</td>
                <td>{scoreLabel(a.grammar)}</td>
                <td>{scoreLabel(a.vocabulary)}</td>
                <td>{scoreLabel(a.fillerWords)}</td>
                <td>{scoreLabel(a.technicalAccuracy)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
