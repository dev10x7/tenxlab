'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, type BankQuestion } from '@/lib/api';
import { questionKindLabel } from '@/lib/lms';

const KINDS = ['coding', 'mcq', 'fill', 'descriptive'] as const;
type Kind = (typeof KINDS)[number];

/**
 * Question Bank — reusable questions (ByteXL parity §2.4).
 *
 * An instructor keeps a tenant-scoped library of questions they can drop into
 * any test instead of re-typing it. Multiple-choice questions require at least
 * two options; the API enforces the same rule.
 */
export default function QuestionBankPage() {
  const [role, setRole] = useState<'student' | 'instructor' | 'admin' | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api
      .session()
      .then((s) => setRole(s?.role ?? null))
      .catch(() => setRole(null))
      .finally(() => setLoaded(true));
  }, []);

  if (!loaded) return <p className="muted">Loading question bank…</p>;
  if (!role) return <p className="error">Please sign in to manage the bank.</p>;
  if (role === 'student') {
    return (
      <div>
        <h1>Question Bank</h1>
        <p className="muted">
          The question bank is available to instructors and admins.
        </p>
      </div>
    );
  }

  return <BankView />;
}

function BankView() {
  const [questions, setQuestions] = useState<BankQuestion[] | null>(null);
  const [kindFilter, setKindFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setQuestions(
        await api.bankQuestions({
          kind: kindFilter || undefined,
          tag: tagFilter.trim() || undefined,
        }),
      );
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 403
          ? 'The question bank is available to instructors and admins.'
          : 'Could not load the question bank.',
      );
    }
  }, [kindFilter, tagFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async (id: string) => {
    try {
      await api.deleteBankQuestion(id);
      setQuestions((prev) => prev?.filter((q) => q.id !== id) ?? null);
    } catch {
      setError('Could not delete that question.');
    }
  };

  return (
    <div>
      <h1>Question Bank</h1>
      <p className="muted" style={{ maxWidth: 640 }}>
        Reusable questions across your courses. Add one here and drop it into any
        test.
      </p>

      {error ? <p className="error">{error}</p> : null}

      <CreateQuestion onCreated={() => void load()} onError={setError} />

      <div className="row" style={{ gap: 12, marginTop: 24, alignItems: 'flex-end' }}>
        <label>
          <div className="muted" style={{ fontSize: 12 }}>
            Kind
          </div>
          <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)}>
            <option value="">All kinds</option>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {questionKindLabel(k)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <div className="muted" style={{ fontSize: 12 }}>
            Tag
          </div>
          <input
            value={tagFilter}
            onChange={(e) => setTagFilter(e.target.value)}
            placeholder="e.g. kubernetes"
          />
        </label>
      </div>

      {questions === null && !error ? (
        <p className="muted">Loading questions…</p>
      ) : null}
      {questions && questions.length === 0 ? (
        <p className="muted" style={{ marginTop: 16 }}>
          No questions match. Add one above.
        </p>
      ) : null}

      {questions && questions.length > 0 ? (
        <table className="gradebook" style={{ marginTop: 16 }}>
          <thead>
            <tr>
              <th>Kind</th>
              <th>Prompt</th>
              <th>Score</th>
              <th>Tags</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {questions.map((q) => (
              <tr key={q.id}>
                <td>{questionKindLabel(q.kind)}</td>
                <td>
                  {q.prompt}
                  {q.options.length > 0 ? (
                    <div className="muted" style={{ fontSize: 12 }}>
                      {q.options.join(' · ')}
                    </div>
                  ) : null}
                </td>
                <td>{q.maxScore}</td>
                <td className="muted">{q.tags.join(', ')}</td>
                <td>
                  <button onClick={() => void remove(q.id)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}

function CreateQuestion({
  onCreated,
  onError,
}: {
  onCreated: () => void;
  onError: (message: string) => void;
}) {
  const [kind, setKind] = useState<Kind>('mcq');
  const [prompt, setPrompt] = useState('');
  const [options, setOptions] = useState('');
  const [maxScore, setMaxScore] = useState('1');
  const [tags, setTags] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    try {
      await api.createBankQuestion({
        kind,
        prompt: prompt.trim(),
        options:
          kind === 'mcq'
            ? options
                .split('\n')
                .map((o) => o.trim())
                .filter(Boolean)
            : undefined,
        maxScore: Number(maxScore) || 1,
        tags: tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      });
      setPrompt('');
      setOptions('');
      setTags('');
      onCreated();
    } catch (err) {
      onError(
        err instanceof ApiError && err.status === 400
          ? 'That question was rejected — check the prompt and options.'
          : 'Could not add the question.',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h3 style={{ marginTop: 0 }}>Add a question</h3>
      <div className="row" style={{ gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label>
          <div className="muted" style={{ fontSize: 12 }}>
            Kind
          </div>
          <select value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {questionKindLabel(k)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <div className="muted" style={{ fontSize: 12 }}>
            Max score
          </div>
          <input
            value={maxScore}
            onChange={(e) => setMaxScore(e.target.value)}
            inputMode="numeric"
            style={{ width: 80 }}
          />
        </label>
        <label style={{ flex: 1, minWidth: 200 }}>
          <div className="muted" style={{ fontSize: 12 }}>
            Tags (comma-separated)
          </div>
          <input value={tags} onChange={(e) => setTags(e.target.value)} />
        </label>
      </div>

      <label>
        <div className="muted" style={{ fontSize: 12, marginTop: 12 }}>
          Prompt
        </div>
        <textarea
          rows={3}
          style={{ width: '100%' }}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
      </label>

      {kind === 'mcq' ? (
        <label>
          <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
            Options (one per line)
          </div>
          <textarea
            rows={3}
            style={{ width: '100%' }}
            value={options}
            onChange={(e) => setOptions(e.target.value)}
          />
        </label>
      ) : null}

      <div className="row" style={{ marginTop: 8 }}>
        <button onClick={() => void submit()} disabled={busy || !prompt.trim()}>
          {busy ? 'Adding…' : 'Add question'}
        </button>
      </div>
    </div>
  );
}
