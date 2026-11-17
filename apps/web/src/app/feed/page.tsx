'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, type FeedItem } from '@/lib/api';
import { feedKindLabel } from '@/lib/lms';

/**
 * Feed — the cohort activity stream (ByteXL parity §2.9).
 *
 * A reverse-chronological view of what the caller's batch has been doing:
 * project submissions, completed lessons, and social posts. It is derived from
 * the primary tables on the server, so it never needs a separate write path.
 */
export default function FeedPage() {
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .feed()
      .then(setItems)
      .catch(() => setError('Could not load your feed. Please try again.'));
  }, []);

  return (
    <div>
      <h1>Feed</h1>
      <p className="muted" style={{ maxWidth: 640 }}>
        What your batch has been up to: lesson completions, project submissions,
        and posts — newest first.
      </p>

      {error ? <p className="error">{error}</p> : null}
      {!error && items === null ? <p className="muted">Loading feed…</p> : null}

      {items && items.length === 0 ? (
        <p className="muted" style={{ marginTop: 16 }}>
          Nothing here yet. Complete a lesson, submit a project, or post an update
          to get started.
        </p>
      ) : null}

      <ul className="feed" style={{ listStyle: 'none', padding: 0, marginTop: 16 }}>
        {items?.map((item) => (
          <li key={item.id} className="card" style={{ marginBottom: 12 }}>
            <div className="row" style={{ alignItems: 'baseline' }}>
              <span className="pill">{feedKindLabel(item.kind)}</span>
              <span className="muted" style={{ marginLeft: 'auto', fontSize: 12 }}>
                {formatWhen(item.createdAt)}
              </span>
            </div>
            <p style={{ margin: '8px 0 0' }}>
              <strong>{item.actorName}</strong> {item.title}
            </p>
            {item.detail ? (
              <p className="muted" style={{ margin: '4px 0 0' }}>
                {item.detail}
              </p>
            ) : null}
            {item.href ? (
              <p style={{ margin: '8px 0 0' }}>
                <Link href={item.href}>Open →</Link>
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString();
}
