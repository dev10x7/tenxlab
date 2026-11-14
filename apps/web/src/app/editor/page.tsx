'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  api,
  ApiError,
  type CodeRunResult,
  type EditorLanguage,
  type Snippet,
  type TutorMode,
  type TutorReview,
} from '@/lib/api';
import { runStatusLabel, snippetTitle } from '@/lib/lms';
import { CodeEditor } from '@/components/CodeEditor';

/**
 * The Editor surface: pick a language, write code, run it with STDIN, and keep
 * snippets for later. ByteXL's most-used student screen.
 *
 * The API owns the language catalog and the code runner; this page is the thin
 * client. Saving is available even when the execution pool is off, so a student
 * can still write and keep code — only Run reports that the pool is down.
 */
export default function EditorPage() {
  const [languages, setLanguages] = useState<EditorLanguage[]>([]);
  const [languageId, setLanguageId] = useState<string>('python');
  const [source, setSource] = useState('');
  const [stdin, setStdin] = useState('');
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [activeSnippetId, setActiveSnippetId] = useState<string | null>(null);
  const [title, setTitle] = useState('');

  const [result, setResult] = useState<CodeRunResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [mode, setMode] = useState<TutorMode>('assist');
  const [review, setReview] = useState<TutorReview | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  const language = languages.find((l) => l.id === languageId) ?? languages[0];

  const loadSnippets = useCallback(async () => {
    setSnippets(await api.snippets());
  }, []);

  useEffect(() => {
    async function boot() {
      try {
        const langs = await api.editorLanguages();
        setLanguages(langs);
        setSource(langs.find((l) => l.id === 'python')?.template ?? langs[0]?.template ?? '');
        await loadSnippets();
      } catch (err) {
        setError(
          err instanceof ApiError && err.status === 401
            ? 'Sign in to use the editor.'
            : 'Could not load the editor. Please try again.',
        );
      } finally {
        setLoading(false);
      }
    }
    void boot();
  }, [loadSnippets]);

  function onPickLanguage(id: string) {
    setLanguageId(id);
    const lang = languages.find((l) => l.id === id);
    // Switching language with an untouched draft should swap the template; a
    // hand-edited buffer is left alone.
    const previous = languages.find((l) => l.id === languageId);
    if (lang && (!source.trim() || source === previous?.template)) {
      setSource(lang.template);
    }
  }

  async function onRun() {
    setRunning(true);
    setError(null);
    setNotice(null);
    try {
      setResult(await api.runCode({ language: languageId, source, stdin }));
    } catch (err) {
      if (err instanceof ApiError && err.status === 503) {
        setError('Code execution is not available right now.');
      } else if (err instanceof ApiError && err.status === 400) {
        setError('That language is not supported.');
      } else {
        setError('Could not run your code. Please try again.');
      }
    } finally {
      setRunning(false);
    }
  }

  async function onSave() {
    setError(null);
    setNotice(null);
    try {
      if (activeSnippetId) {
        await api.updateSnippet(activeSnippetId, { title, source, stdin, language: languageId });
        setNotice('Snippet updated.');
      } else {
        const saved = await api.saveSnippet({ language: languageId, title, source, stdin });
        setActiveSnippetId(saved.id);
        setNotice('Snippet saved.');
      }
      await loadSnippets();
    } catch {
      setError('Could not save the snippet.');
    }
  }

  async function onReview() {
    setReviewing(true);
    setReviewError(null);
    try {
      setReview(
        await api.reviewCode({
          language: languageId,
          source,
          mode,
          // The runtime error the student just saw, so the tutor can name it.
          stderr: result?.stderr ?? '',
        }),
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 503) {
        setReviewError('AI review is not available right now.');
      } else if (err instanceof ApiError && err.status === 400) {
        setReviewError('That language is not supported.');
      } else {
        setReviewError('Could not review your code. Please try again.');
      }
    } finally {
      setReviewing(false);
    }
  }

  function applyCorrection() {
    if (review?.correctedCode) {
      setSource(review.correctedCode);
      setNotice('Applied the AI’s suggested code.');
    }
  }

  function openSnippet(snippet: Snippet) {
    setActiveSnippetId(snippet.id);
    setTitle(snippet.title);
    setLanguageId(snippet.language);
    setSource(snippet.source);
    setStdin(snippet.stdin);
    setResult(null);
    setNotice(null);
    setError(null);
    setReview(null);
    setReviewError(null);
  }

  function newSnippet() {
    setActiveSnippetId(null);
    setTitle('');
    setSource(language?.template ?? '');
    setStdin('');
    setResult(null);
    setNotice(null);
    setError(null);
    setReview(null);
    setReviewError(null);
  }

  async function deleteSnippet(id: string) {
    try {
      await api.deleteSnippet(id);
      if (id === activeSnippetId) setActiveSnippetId(null);
      await loadSnippets();
    } catch {
      setError('Could not delete the snippet.');
    }
  }

  if (loading) return <p className="muted">Loading editor…</p>;

  return (
    <div>
      <div className="row">
        <h1 style={{ marginBottom: 0 }}>Editor</h1>
        <span className="pill">P2</span>
      </div>
      <p className="muted" style={{ maxWidth: 640 }}>
        Practise in the browser: pick a language, write code, run it against your
        own input, and save snippets to come back to.
      </p>

      {error ? <p className="error">{error}</p> : null}
      {notice ? <p className="muted">{notice}</p> : null}

      <div className="editor-layout">
        <section className="card editor-main">
          <div className="row" style={{ gap: 12, alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <label htmlFor="editor-language">Language</label>
              <select
                id="editor-language"
                value={languageId}
                onChange={(e) => onPickLanguage(e.target.value)}
              >
                {languages.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ flex: 2 }}>
              <label htmlFor="editor-title">Snippet title</label>
              <input
                id="editor-title"
                value={title}
                placeholder="Untitled"
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <CodeEditor
              value={source}
              language={language?.cmLanguage ?? 'python'}
              onChange={setSource}
              onRun={onRun}
            />
          </div>

          <div className="row" style={{ gap: 8, marginTop: 12, alignItems: 'center' }}>
            <button className="btn" type="button" onClick={onRun} disabled={running}>
              {running ? 'Running…' : 'Run ▷'}
            </button>
            <button className="btn secondary" type="button" onClick={onSave}>
              {activeSnippetId ? 'Update snippet' : 'Save snippet'}
            </button>
            <button className="btn secondary" type="button" onClick={newSnippet}>
              New
            </button>
            <button className="btn secondary" type="button" onClick={onReview} disabled={reviewing}>
              {reviewing ? 'Asking…' : 'Ask AI'}
            </button>
            <label className="muted" style={{ fontSize: 12 }}>
              <select
                aria-label="Tutor mode"
                value={mode}
                onChange={(e) => setMode(e.target.value as TutorMode)}
                style={{ marginLeft: 4 }}
              >
                <option value="assist">Assist (show fix)</option>
                <option value="socratic">Socratic (hint only)</option>
              </select>
            </label>
            <span className="muted" style={{ fontSize: 12 }}>
              ⌘/Ctrl + Enter to run
            </span>
          </div>

          <div style={{ marginTop: 12 }}>
            <label htmlFor="editor-stdin">Standard input (STDIN)</label>
            <textarea
              id="editor-stdin"
              className="stdin"
              value={stdin}
              placeholder={language?.stdinHint ?? ''}
              onChange={(e) => setStdin(e.target.value)}
              rows={3}
            />
          </div>
        </section>

        <aside className="editor-side">
          <section className="card">
            <h3 style={{ marginTop: 0 }}>Output</h3>
            {result ? (
              <>
                <p className="muted" style={{ marginTop: 0 }}>
                  {runStatusLabel(result)}
                </p>
                <pre className="console">{result.stdout || '(no output)'}</pre>
                {result.stderr ? <pre className="console error-out">{result.stderr}</pre> : null}
              </>
            ) : (
              <p className="muted" style={{ marginBottom: 0 }}>
                Run your code to see its output here.
              </p>
            )}
          </section>

          <section className="card">
            <h3 style={{ marginTop: 0 }}>AI assistant</h3>
            {reviewError ? <p className="error">{reviewError}</p> : null}
            {review ? (
              <>
                <p className="muted" style={{ marginTop: 0 }}>
                  {review.mode === 'assist' ? 'Assist' : 'Socratic'} ·{' '}
                  {review.issueCount === 0
                    ? 'no issues spotted'
                    : `${review.issueCount} issue${review.issueCount === 1 ? '' : 's'}`}
                </p>
                <p style={{ marginTop: 0 }}>{review.explanation}</p>
                {review.followUpQuestion ? (
                  <p className="muted" style={{ marginTop: 0 }}>
                    <em>{review.followUpQuestion}</em>
                  </p>
                ) : null}
                {review.correctedCode ? (
                  <>
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <span className="muted" style={{ fontSize: 12 }}>
                        Suggested code
                      </span>
                      <button className="btn secondary" type="button" onClick={applyCorrection}>
                        Insert
                      </button>
                    </div>
                    <pre className="console">{review.correctedCode}</pre>
                  </>
                ) : null}
                {review.issues.length > 0 ? (
                  <ul className="issue-list">
                    {review.issues.map((issue, i) => (
                      <li key={`${issue.code}-${i}`}>
                        <span className="muted">
                          {issue.line ? `Line ${issue.line}: ` : ''}
                        </span>
                        {issue.message}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            ) : (
              <p className="muted" style={{ marginBottom: 0 }}>
                Run your code, then <strong>Ask AI</strong> to explain errors and suggest a fix.
              </p>
            )}
          </section>

          <section className="card">
            <h3 style={{ marginTop: 0 }}>Saved snippets</h3>
            {snippets.length === 0 ? (
              <p className="muted" style={{ marginBottom: 0 }}>
                Nothing saved yet.
              </p>
            ) : (
              <ul className="snippet-list">
                {snippets.map((s) => (
                  <li key={s.id} className={s.id === activeSnippetId ? 'active' : ''}>
                    <button type="button" className="link" onClick={() => openSnippet(s)}>
                      <strong>{snippetTitle(s.title)}</strong>
                      <span className="muted"> · {s.language}</span>
                    </button>
                    <button
                      type="button"
                      className="link danger"
                      aria-label={`Delete ${snippetTitle(s.title)}`}
                      onClick={() => deleteSnippet(s.id)}
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}

