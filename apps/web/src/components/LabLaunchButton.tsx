'use client';

import { useState } from 'react';
import { api, ApiError } from '@/lib/api';

export function LabLaunchButton({ lessonId }: { lessonId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function launch() {
    setBusy(true);
    setError(null);
    try {
      const { launchUrl } = await api.launchLab(lessonId);
      // Full-page navigation to the KubeLab SSO entry point: the launch JWT is
      // consumed by the execution plane, never by this client.
      window.location.assign(launchUrl);
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setError('Your institution has reached its concurrent lab limit. Try again shortly.');
      } else if (err instanceof ApiError && err.status === 403) {
        setError('Your enrolment does not allow launching this lab.');
      } else {
        setError('Could not start the lab. Please try again.');
      }
      setBusy(false);
    }
  }

  return (
    <div>
      <button className="btn" onClick={launch} disabled={busy}>
        {busy ? 'Starting lab…' : 'Launch lab'}
      </button>
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}
