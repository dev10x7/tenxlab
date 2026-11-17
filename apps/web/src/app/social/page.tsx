'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, type Session, type SocialMember, type SocialPost } from '@/lib/api';

/**
 * Social — the batch micro-feed (ByteXL parity §2.9).
 *
 * A student posts a short update and follows peers. The feed can show the whole
 * tenant or only the people the caller follows; the directory lists members
 * with their follower counts and a follow toggle.
 */
export default function SocialPage() {
  const [session, setSession] = useState<Session | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    api
      .session()
      .then(setSession)
      .catch(() => setSession(null))
      .finally(() => setLoaded(true));
  }, []);

  if (!loaded) return <p className="muted">Loading social…</p>;
  if (!session) return <p className="error">Please sign in to view your community.</p>;

  return (
    <div>
      <h1>Social</h1>
      <p className="muted" style={{ maxWidth: 640 }}>
        Share an update with your batch and follow the peers you want to keep up
        with.
      </p>
      <div className="row" style={{ gap: 32, alignItems: 'flex-start', marginTop: 16 }}>
        <div style={{ flex: 2, minWidth: 320 }}>
          <Composer onPosted={() => setRefreshKey((k) => k + 1)} />
          <Feed userId={session.userId} refreshKey={refreshKey} />
        </div>
        <div style={{ flex: 1, minWidth: 240 }}>
          <Directory />
        </div>
      </div>
    </div>
  );
}

function Composer({ onPosted }: { onPosted: () => void }) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!body.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.createPost(body.trim());
      setBody('');
      onPosted();
    } catch {
      setError('Could not publish your post.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <textarea
        rows={3}
        style={{ width: '100%' }}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Share an update with your batch…"
        disabled={busy}
      />
      {error ? <p className="error">{error}</p> : null}
      <div className="row" style={{ marginTop: 8 }}>
        <button onClick={() => void submit()} disabled={busy || !body.trim()}>
          {busy ? 'Posting…' : 'Post'}
        </button>
      </div>
    </div>
  );
}

function Feed({ userId, refreshKey }: { userId: string; refreshKey: number }) {
  const [posts, setPosts] = useState<SocialPost[] | null>(null);
  const [followingOnly, setFollowingOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setPosts(await api.socialFeed(followingOnly));
    } catch {
      setError('Could not load the feed.');
    }
  }, [followingOnly]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const remove = async (id: string) => {
    try {
      await api.deletePost(id);
      setPosts((prev) => prev?.filter((p) => p.id !== id) ?? null);
    } catch {
      setError('Could not delete that post.');
    }
  };

  return (
    <section style={{ marginTop: 24 }}>
      <div className="row">
        <h2 style={{ marginBottom: 0 }}>Feed</h2>
        <label className="row" style={{ marginLeft: 'auto', gap: 6 }}>
          <input
            type="checkbox"
            checked={followingOnly}
            onChange={(e) => setFollowingOnly(e.target.checked)}
          />
          <span className="muted">Following only</span>
        </label>
      </div>

      {error ? <p className="error">{error}</p> : null}
      {posts === null && !error ? <p className="muted">Loading feed…</p> : null}
      {posts && posts.length === 0 ? (
        <p className="muted">No posts yet. Be the first to share an update.</p>
      ) : null}

      <ul style={{ listStyle: 'none', padding: 0 }}>
        {posts?.map((post) => (
          <li key={post.id} className="card" style={{ marginBottom: 12 }}>
            <div className="row" style={{ alignItems: 'baseline' }}>
              <strong>{post.authorName}</strong>
              <span className="muted" style={{ marginLeft: 'auto', fontSize: 12 }}>
                {formatWhen(post.createdAt)}
              </span>
            </div>
            <p style={{ whiteSpace: 'pre-wrap', margin: '8px 0 0' }}>{post.body}</p>
            {post.authorId === userId ? (
              <button
                style={{ marginTop: 8 }}
                onClick={() => void remove(post.id)}
              >
                Delete
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Directory() {
  const [members, setMembers] = useState<SocialMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setMembers(await api.socialMembers());
    } catch {
      setError('Could not load members.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = async (member: SocialMember) => {
    try {
      if (member.followedByMe) await api.unfollowMember(member.userId);
      else await api.followMember(member.userId);
      await load();
    } catch {
      setError('Could not update the follow.');
    }
  };

  return (
    <section>
      <h2>People</h2>
      {error ? <p className="error">{error}</p> : null}
      {members === null && !error ? <p className="muted">Loading members…</p> : null}
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {members?.map((m) => (
          <li
            key={m.userId}
            className="card"
            style={{ marginBottom: 8, padding: 12 }}
          >
            <div>{m.fullName}</div>
            <div className="muted" style={{ fontSize: 12 }}>
              {m.followers} followers · {m.following} following
            </div>
            <button style={{ marginTop: 6 }} onClick={() => void toggle(m)}>
              {m.followedByMe ? 'Unfollow' : 'Follow'}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString();
}
