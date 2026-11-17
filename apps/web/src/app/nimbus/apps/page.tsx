'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  api,
  type ForkStatus,
  type StudentProjectView,
} from '@/lib/api';
import { workspaceStatusLabel } from '@/lib/lms';

interface AppRow {
  projectTitle: string;
  componentTitle: string;
  technology: string;
  forkId: string;
  status: ForkStatus;
}

/**
 * Nimbus Apps — the student's published workspaces and live demo URLs. Deploy a
 * workspace from Nimbus, then showcase the running app from here (ByteXL's
 * "Publish Apps" landing view).
 */
export default function NimbusAppsPage() {
  const [rows, setRows] = useState<AppRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const projects = (await api.projects()) as StudentProjectView[];
        const forked = projects.flatMap((view) =>
          view.components
            .filter((c) => c.fork)
            .map((c) => ({
              projectTitle: view.project.title,
              componentTitle: c.title,
              technology: c.technology,
              forkId: c.fork!.id,
            })),
        );
        const statuses = await Promise.all(
          forked.map((f) =>
            api.forkStatus(f.forkId).then((status) => ({ ...f, status })),
          ),
        );
        if (active) setRows(statuses);
      } catch {
        if (active) setError('Could not load your apps. Please try again.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  if (loading) return <p className="muted">Loading your apps…</p>;
  if (error) return <p className="error">{error}</p>;

  return (
    <div>
      <h1>Nimbus Apps</h1>
      <p className="muted" style={{ maxWidth: 680 }}>
        Your forked workspaces and the demo URLs they are published on. Deploy a
        running workspace from <Link href="/nimbus">Nimbus</Link> to publish it
        here.
      </p>

      {rows.length === 0 ? (
        <p className="muted">
          You have no workspaces yet. <Link href="/nimbus">Fork a project →</Link>
        </p>
      ) : (
        <div className="grid" style={{ marginTop: 16 }}>
          {rows.map((row) => (
            <div key={row.forkId} className="card">
              <div className="row">
                <h3 style={{ margin: 0 }}>{row.componentTitle}</h3>
                <span className="pill">{workspaceStatusLabel(row.status.status)}</span>
              </div>
              <p className="muted" style={{ marginBottom: 0 }}>
                {row.projectTitle} · {row.technology}
              </p>
              <p style={{ marginBottom: 0 }}>
                {row.status.deployUrl ? (
                  <a href={row.status.deployUrl} target="_blank" rel="noreferrer">
                    Open live app →
                  </a>
                ) : (
                  <span className="muted">Not deployed yet.</span>
                )}
              </p>
              {row.status.ideUrl ? (
                <p style={{ marginBottom: 0 }}>
                  <a href={row.status.ideUrl} target="_blank" rel="noreferrer">
                    Open workspace →
                  </a>
                </p>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
