'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, type LabSession } from '@/lib/api';
import { labLaunchState } from '@/lib/lms';

type Phase = 'idle' | 'provisioning' | 'ready' | 'failed';

/** Poll cadence while a vcluster cold-starts (typically 1-4 minutes). */
const POLL_MS = 5000;
const MAX_WAIT_MS = 8 * 60 * 1000;

/**
 * Launches a lab and follows it to readiness.
 *
 * KubeLab cold start takes minutes, so the API returns a session id immediately
 * and this component polls until the session is ACTIVE with an IDE URL, then
 * hands the student off to code-server in a new tab.
 */
export function LabLaunchButton({ lessonId }: { lessonId: string }) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [ideUrl, setIdeUrl] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const poll = useCallback(async (sessionId: string, deadline: number) => {
    if (Date.now() > deadline) {
      setPhase('failed');
      setError('The lab is taking longer than expected. Please try again.');
      return;
    }
    try {
      const session: LabSession = await api.labSession(sessionId);
      const state = labLaunchState(session);
      if (state.failed) {
        setPhase('failed');
        setError('The lab environment could not be started. Please try again.');
        return;
      }
      if (state.ready && state.ideUrl) {
        setIdeUrl(state.ideUrl);
        setPhase('ready');
        return;
      }
      timer.current = setTimeout(() => void poll(sessionId, deadline), POLL_MS);
    } catch {
      timer.current = setTimeout(() => void poll(sessionId, deadline), POLL_MS);
    }
  }, []);

  async function launch() {
    setPhase('provisioning');
    setError(null);
    setIdeUrl(null);
    try {
      const session = await api.launchLab(lessonId);
      const state = labLaunchState(session);
      if (state.ready && state.ideUrl) {
        setIdeUrl(state.ideUrl);
        setPhase('ready');
        return;
      }
      void poll(session.sessionId, Date.now() + MAX_WAIT_MS);
    } catch (err) {
      setPhase('failed');
      if (err instanceof ApiError && err.status === 429) {
        setError('Your institution has reached its concurrent lab limit. Try again shortly.');
      } else if (err instanceof ApiError && err.status === 401) {
        setError('Please sign in again to launch this lab.');
      } else {
        setError('Could not start the lab. Please try again.');
      }
    }
  }

  return (
    <div>
      {phase === 'ready' && ideUrl ? (
        <a className="btn" href={ideUrl} target="_blank" rel="noreferrer">
          Open your lab environment
        </a>
      ) : (
        <button className="btn" onClick={launch} disabled={phase === 'provisioning'}>
          {phase === 'provisioning' ? 'Provisioning your cluster…' : 'Launch lab'}
        </button>
      )}
      {phase === 'provisioning' ? (
        <p className="muted" style={{ marginBottom: 0 }}>
          Building a real Kubernetes cluster. This usually takes one to two minutes.
        </p>
      ) : null}
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}
