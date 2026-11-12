'use client';

import { useEffect, useRef } from 'react';
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { defaultKeymap, indentWithTab } from '@codemirror/commands';
import { basicSetup } from 'codemirror';
import { oneDark } from '@codemirror/theme-one-dark';
import { python } from '@codemirror/lang-python';
import { javascript } from '@codemirror/lang-javascript';
import { java } from '@codemirror/lang-java';
import { cpp } from '@codemirror/lang-cpp';
import { sql } from '@codemirror/lang-sql';

/**
 * CodeMirror 6 wrapper (ADR-19). CodeMirror is MIT and tree-shakes to the
 * languages we import, so only the ones in the picker reach the bundle.
 *
 * The editor owns its document; the React state mirrors it. External value
 * changes (loading a saved snippet) are pushed into the view only when they
 * differ, so typing does not fight the controlled prop.
 */
export interface CodeEditorProps {
  value: string;
  /** CodeMirror language id, e.g. `python`, `cpp`, `sql`. */
  language: string;
  onChange: (value: string) => void;
  /** Invoked on Mod-Enter (Cmd/Ctrl-Enter) to run. */
  onRun?: () => void;
}

function languageExtension(id: string) {
  switch (id) {
    case 'python':
      return python();
    case 'javascript':
      return javascript();
    case 'java':
      return java();
    case 'cpp':
    case 'c':
      return cpp();
    case 'sql':
      return sql();
    default:
      return [];
  }
}

export function CodeEditor({ value, language, onChange, onRun }: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const languageRef = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  const onRunRef = useRef(onRun);

  onChangeRef.current = onChange;
  onRunRef.current = onRun;

  useEffect(() => {
    if (!hostRef.current) return;

    const state = EditorState.create({
      doc: value,
      extensions: [
        basicSetup,
        oneDark,
        languageRef.current.of(languageExtension(language)),
        keymap.of([
          {
            key: 'Mod-Enter',
            run: () => {
              onRunRef.current?.();
              return true;
            },
          },
          indentWithTab,
          ...defaultKeymap,
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) onChangeRef.current(update.state.doc.toString());
        }),
      ],
    });

    const view = new EditorView({ state, parent: hostRef.current });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // The editor is created once; value/language changes are applied below so
    // re-mounting (and losing the cursor) never happens on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (value !== current) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
    }
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: languageRef.current.reconfigure(languageExtension(language)),
    });
  }, [language]);

  return <div ref={hostRef} className="code-editor" />;
}
