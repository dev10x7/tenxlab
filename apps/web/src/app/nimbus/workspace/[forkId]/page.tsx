'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { api, ApiError, type ForkStatus } from '@/lib/api';
import { forkReadyState } from '@/lib/lms';

/** Poll cadence while a workspace cold-starts (typically one to two minutes). */
const POLL_MS = 5000;
const MAX_WAIT_MS = 8 * 60 * 1000;

type Phase = 'provisioning' | 'ready' | 'stopped' | 'failed';

/**
 * The Nimbus workspace view: the online VS Code (code-server) embedded in the
 * main panel, the way ByteXL opens it, rather than a new browser tab. The
 * sidebar stays available so the student can move between surfaces while their
 * workspace runs. A new-tab link remains as a fallback for browsers that refuse
 * the cross-origin frame.
 */
export default function NimbusWorkspacePage({
  params,
}: {
  params: { forkId: string };
}) {
  const { forkId } = params;
  const [phase, setPhase] = useState<Phase>('provisioning');
  const [status, setStatus] = useState<ForkStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const poll = useCallback(async (id: string, deadline: number) => {
    if (Date.now() > deadline) {
      setPhase('failed');
      setError('The workspace is taking longer than expected. Please try again.');
      return;
    }
    try {
      const next = await api.forkStatus(id);
      setStatus(next);
      const state = forkReadyState(next);
      if (state.failed) {
        setPhase('failed');
        setError('The workspace could not be started. Please try again.');
        return;
      }
      if (state.ready) {
        setPhase('ready');
        return;
      }
      if (next.status === 'stopped') {
        setPhase('stopped');
        return;
      }
      timer.current = setTimeout(() => void poll(id, deadline), POLL_MS);
    } catch (err) {
      // A missing or forbidden fork will never become ready; stop polling.
      if (err instanceof ApiError && (err.status === 404 || err.status === 403)) {
        setPhase('failed');
        setError('This workspace is no longer available.');
        return;
      }
      timer.current = setTimeout(() => void poll(id, deadline), POLL_MS);
    }
  }, []);

  useEffect(() => {
    void poll(forkId, Date.now() + MAX_WAIT_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [forkId, poll]);

  async function stop() {
    if (!status?.workspaceId) return;
    setBusy(true);
    setError(null);
    try {
      await api.stopWorkspace(status.workspaceId);
      setPhase('stopped');
      setStatus({ ...status, status: 'stopped', ideUrl: null });
    } catch {
      setError('Could not stop the workspace. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (phase === 'ready' && status?.ideUrl) {
    return (
      <div className="ide-panel">
        <div className="ide-panel-bar">
          <span className="muted">Cloud VS Code workspace</span>
          <div className="row" style={{ gap: 8 }}>
            <a className="btn secondary" href={status.ideUrl} target="_blank" rel="noreferrer">
              Open in new tab
            </a>
            <button className="btn secondary" onClick={stop} disabled={busy}>
              Stop workspace
            </button>
            <a
              className="btn secondary"
              href={`/api/projects/workspaces/${encodeURIComponent(status.workspaceId)}/download`}
            >
              Download files
            </a>
          </div>
        </div>
        <iframe
          className="ide-frame"
          src={status.ideUrl}
          title="Nimbus workspace"
          allow="clipboard-read; clipboard-write; fullscreen"
        />
      </div>
    );
  }

  return (
    <div>
      <h1>Workspace</h1>
      {error ? <p className="error">{error}</p> : null}

      {phase === 'provisioning' ? (
        <p className="muted">
          Starting your cloud workspace… this usually takes one to two minutes.
        </p>
      ) : null}

      {phase === 'stopped' ? (
        <p className="muted">
          This workspace is stopped. Re-open it from{' '}
          <Link href="/nimbus">Nimbus</Link> to resume building — your files are
          kept.
        </p>
      ) : null}

      <Link className="btn secondary" href="/nimbus">
        Back to Nimbus
      </Link>
    </div>
  );
}
