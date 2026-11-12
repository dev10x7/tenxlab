'use client';

import { useEffect, useRef, useState } from 'react';
import { api, type ProctorEventType } from '@/lib/api';

/**
 * Browser-side proctoring capture for a live graded attempt.
 *
 * The server never trusts these signals as proof of cheating — it stores them
 * and aggregates a risk score an instructor reviews. This component only
 * *reports* what the browser can observe: tab/window focus, clipboard use, and
 * fullscreen exit. It renders a small banner so the student knows they are
 * being recorded (transparency, and it satisfies exam-policy disclosure).
 */
export function ProctorGuard({ attemptId }: { attemptId: string }) {
  const [signals, setSignals] = useState(0);
  const reportedRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    function report(type: ProctorEventType, detail?: string) {
      if (cancelled) return;
      reportedRef.current += 1;
      setSignals(reportedRef.current);
      // Fire-and-forget: a dropped signal must never block the exam UI.
      void api.recordProctorEvent(attemptId, type, detail).catch(() => undefined);
    }

    const onBlur = () => report('focus_lost', 'window blur');
    const onFocus = () => report('focus_gained');
    const onCopy = () => report('copy');
    const onPaste = () => report('paste');
    const onFullscreen = () => {
      if (!document.fullscreenElement) report('fullscreen_exit');
    };
    const onOffline = () => report('network_lost');

    window.addEventListener('blur', onBlur);
    window.addEventListener('focus', onFocus);
    document.addEventListener('copy', onCopy);
    document.addEventListener('paste', onPaste);
    document.addEventListener('fullscreenchange', onFullscreen);
    window.addEventListener('offline', onOffline);

    return () => {
      cancelled = true;
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('paste', onPaste);
      document.removeEventListener('fullscreenchange', onFullscreen);
      window.removeEventListener('offline', onOffline);
    };
  }, [attemptId]);

  return (
    <p className="muted" style={{ marginTop: 8 }}>
      This exam is proctored. Tab switches, copy/paste, and fullscreen exits are
      recorded.{' '}
      <span className={`pill ${signals > 0 ? 'medium' : ''}`}>
        {signals} {signals === 1 ? 'signal' : 'signals'} recorded
      </span>
    </p>
  );
}
