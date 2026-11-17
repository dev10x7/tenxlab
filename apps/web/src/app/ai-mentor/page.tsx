'use client';

import { useEffect, useRef, useState } from 'react';
import { api, type MentorTurn } from '@/lib/api';

/**
 * AI Mentor — a study coach (ByteXL parity §2.5).
 *
 * The student asks a question and the mentor answers from a deterministic
 * knowledge base on the AI plane, with concrete next steps. Both turns are
 * persisted, so the conversation survives a reload; clearing it starts fresh.
 */
export default function AiMentorPage() {
  const [turns, setTurns] = useState<MentorTurn[]>([]);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api
      .mentorHistory()
      .then(setTurns)
      .catch(() => setError('Could not load your conversation.'))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns.length]);

  const ask = async () => {
    const trimmed = question.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    // Show the question immediately; the server echoes the persisted pair.
    const optimistic: MentorTurn = {
      id: `local-${Date.now()}`,
      role: 'user',
      content: trimmed,
      topic: null,
      createdAt: new Date().toISOString(),
    };
    setTurns((prev) => [...prev, optimistic]);
    setQuestion('');
    try {
      const result = await api.askMentor(trimmed);
      setTurns((prev) => [
        ...prev.filter((t) => t.id !== optimistic.id),
        optimistic,
        result.reply,
      ]);
    } catch {
      setTurns((prev) => prev.filter((t) => t.id !== optimistic.id));
      setError('The mentor could not answer just now. Please try again.');
      setQuestion(trimmed);
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setError(null);
    try {
      await api.clearMentor();
      setTurns([]);
    } catch {
      setError('Could not clear the conversation.');
    }
  };

  return (
    <div>
      <div className="row" style={{ alignItems: 'baseline' }}>
        <h1 style={{ marginBottom: 0 }}>AI Mentor</h1>
        {turns.length > 0 ? (
          <button style={{ marginLeft: 'auto' }} onClick={() => void clear()}>
            Clear
          </button>
        ) : null}
      </div>
      <p className="muted" style={{ maxWidth: 640 }}>
        A study coach for your questions — ask about a topic, a lab, or what to
        learn next. It gives concrete next steps, not just an answer.
      </p>

      {error ? <p className="error">{error}</p> : null}

      <div
        className="card"
        style={{ marginTop: 16, minHeight: 200, maxHeight: 480, overflowY: 'auto' }}
      >
        {!loaded ? (
          <p className="muted">Loading conversation…</p>
        ) : turns.length === 0 ? (
          <p className="muted">
            Ask your first question — for example, “How do I fix a
            CrashLoopBackOff?”
          </p>
        ) : (
          turns.map((turn) => (
            <div
              key={turn.id}
              style={{
                margin: '0 0 12px',
                textAlign: turn.role === 'user' ? 'right' : 'left',
              }}
            >
              <span
                className="pill"
                style={{ background: turn.role === 'user' ? '#eef' : '#efe' }}
              >
                {turn.role === 'user' ? 'You' : 'Mentor'}
                {turn.topic ? ` · ${turn.topic}` : ''}
              </span>
              <p style={{ whiteSpace: 'pre-wrap', margin: '6px 0 0' }}>
                {turn.content}
              </p>
            </div>
          ))
        )}
        <div ref={bottom} />
      </div>

      <div className="row" style={{ gap: 8, marginTop: 12 }}>
        <input
          style={{ flex: 1 }}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void ask();
          }}
          placeholder="Ask the mentor a question…"
          disabled={busy}
        />
        <button onClick={() => void ask()} disabled={busy || !question.trim()}>
          {busy ? 'Thinking…' : 'Ask'}
        </button>
      </div>
    </div>
  );
}
