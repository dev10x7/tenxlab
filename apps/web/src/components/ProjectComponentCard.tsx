'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  api,
  ApiError,
  type ForkStatus,
  type GitDeviceGrant,
  type GitPublish,
  type GitStatus,
  type ProjectComponentView,
  type ProjectSubmission,
  type ProjectSummary,
} from '@/lib/api';
import { forkReadyState } from '@/lib/lms';

/** Poll cadence while a workspace cold-starts (typically one to two minutes). */
const POLL_MS = 5000;
const MAX_WAIT_MS = 8 * 60 * 1000;

type Phase = 'idle' | 'provisioning' | 'ready' | 'stopped' | 'failed';

/**
 * One project component for a student: fork its template into a durable
 * workspace, open the online VS Code, stop the workspace, then submit it with
 * optional GitHub/demo links. Mirrors the ByteXL Nimbus flow (fork → build →
 * stop → submit), including the stop-before-submit rule.
 */
export function ProjectComponentCard({
  project,
  component,
  onChanged,
}: {
  project: ProjectSummary;
  component: ProjectComponentView;
  onChanged: () => void;
}) {
  const [phase, setPhase] = useState<Phase>(component.fork ? 'provisioning' : 'idle');
  const [status, setStatus] = useState<ForkStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const poll = useCallback(
    async (forkId: string, deadline: number) => {
      if (Date.now() > deadline) {
        setPhase('failed');
        setError('The workspace is taking longer than expected. Please try again.');
        return;
      }
      try {
        const next = await api.forkStatus(forkId);
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
        timer.current = setTimeout(() => void poll(forkId, deadline), POLL_MS);
      } catch {
        timer.current = setTimeout(() => void poll(forkId, deadline), POLL_MS);
      }
    },
    [],
  );

  // On mount, an existing fork is followed to readiness without re-forking.
  useEffect(() => {
    if (!component.fork) return;
    void poll(component.fork.id, Date.now() + MAX_WAIT_MS);
  }, [component.fork, poll]);

  async function fork() {
    setPhase('provisioning');
    setError(null);
    setBusy(true);
    try {
      const result = await api.forkProjectComponent(project.id, component.id);
      onChanged();
      if (result.status === 'stopped') {
        setPhase('stopped');
        setStatus({ ...result, ideUrl: null } as ForkStatus);
        return;
      }
      void poll(result.forkId, Date.now() + MAX_WAIT_MS);
    } catch (err) {
      setPhase('failed');
      setError(
        err instanceof ApiError && err.status === 403
          ? 'You are not enrolled in this project’s institution.'
          : 'Could not start the workspace. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    if (!status?.workspaceId) return;
    setBusy(true);
    setError(null);
    try {
      await api.stopWorkspace(status.workspaceId);
      setPhase('stopped');
      setStatus({ ...status, status: 'stopped', ideUrl: null });
      onChanged();
    } catch {
      setError('Could not stop the workspace. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="row">
        <h3 style={{ margin: 0 }}>{component.title}</h3>
        <span className="pill">{component.technology}</span>
      </div>
      <p className="muted" style={{ marginTop: 4 }}>
        Template: {component.templateSlug ?? 'fork of your own workspace'}
      </p>

      {error ? <p className="error">{error}</p> : null}

      {phase === 'idle' ? (
        <button className="btn" onClick={fork} disabled={busy}>
          Fork workspace
        </button>
      ) : null}

      {phase === 'provisioning' ? (
        <p className="muted" style={{ marginBottom: 0 }}>
          Starting your cloud workspace… this usually takes one to two minutes.
        </p>
      ) : null}

      {phase === 'ready' && status?.ideUrl ? (
        <div>
          <div className="row" style={{ gap: 8 }}>
            <a className="btn" href={status.ideUrl} target="_blank" rel="noreferrer">
              Open in VS Code
            </a>
            <button className="btn secondary" onClick={stop} disabled={busy}>
              Stop workspace
            </button>
          </div>
          <DeployControl
            workspaceId={status.workspaceId}
            deployUrl={status.deployUrl ?? null}
            onChanged={onChanged}
            onStatus={(deployUrl, deployPort) =>
              setStatus((s) => (s ? { ...s, deployUrl, deployPort } : s))
            }
          />
          <GitPublishControl workspaceId={status.workspaceId} />
        </div>
      ) : null}

      {phase === 'stopped' && status?.workspaceId ? (
        <SubmissionForm
          projectId={project.id}
          componentId={component.id}
          workspaceId={status.workspaceId}
          maxScore={project.maxScore}
          onSubmitted={onChanged}
        />
      ) : null}
    </div>
  );
}

/**
 * Deploy (E5 one-click hosting): expose the running workspace's service on a
 * public URL. The student names the port their app listens on; the resulting
 * link is what they submit as a demo. One workspace exposes one service (§1.4).
 */
function DeployControl({
  workspaceId,
  deployUrl,
  onChanged,
  onStatus,
}: {
  workspaceId: string;
  deployUrl: string | null;
  onChanged: () => void;
  onStatus: (deployUrl: string | null, deployPort: number | null) => void;
}) {
  const [port, setPort] = useState('5000');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function deploy() {
    const value = Number(port);
    if (!Number.isInteger(value) || value <= 0 || value > 65535) {
      setError('Enter the port your app listens on (1–65535).');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api.deployWorkspace(workspaceId, value);
      onStatus(result.deployUrl, result.deployPort);
      onChanged();
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 409
          ? 'Start the workspace before deploying.'
          : 'Could not deploy the service. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function undeploy() {
    setBusy(true);
    setError(null);
    try {
      await api.undeployWorkspace(workspaceId);
      onStatus(null, null);
      onChanged();
    } catch {
      setError('Could not withdraw the deployment. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (deployUrl) {
    return (
      <div style={{ marginTop: 12 }}>
        <p className="muted" style={{ marginBottom: 4 }}>
          Your service is live:
        </p>
        <div className="row" style={{ gap: 8 }}>
          <a className="btn" href={deployUrl} target="_blank" rel="noreferrer">
            Open live URL
          </a>
          <button className="btn secondary" onClick={undeploy} disabled={busy}>
            Undeploy
          </button>
        </div>
        {error ? <p className="error">{error}</p> : null}
      </div>
    );
  }

  return (
    <div style={{ marginTop: 12 }}>
      <label htmlFor={`port-${workspaceId}`}>
        Deploy your app — port it listens on
      </label>
      <div className="row" style={{ gap: 8 }}>
        <input
          id={`port-${workspaceId}`}
          value={port}
          onChange={(e) => setPort(e.target.value)}
          inputMode="numeric"
          style={{ maxWidth: 120 }}
        />
        <button className="btn" onClick={deploy} disabled={busy}>
          Deploy
        </button>
      </div>
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}

/**
 * Git publish (ByteXL's Source Control push): publish the running workspace to
 * the student's own GitHub. The first use walks them through a device-flow
 * connect; afterwards a single click creates/reuses the repo and pushes.
 */
function GitPublishControl({ workspaceId }: { workspaceId: string }) {
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [grant, setGrant] = useState<GitDeviceGrant | null>(null);
  const [publish, setPublish] = useState<GitPublish | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .gitStatus()
      .then(setStatus)
      .catch(() => setStatus({ connected: false, login: null, provider: 'github' }));
  }, []);

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      setGrant(await api.gitConnectStart());
    } catch {
      setError('Could not start GitHub sign-in. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function finishConnect() {
    if (!grant) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.gitConnectComplete(grant.deviceCode);
      setStatus({ connected: result.connected, login: result.login, provider: result.provider });
      setGrant(null);
    } catch (err) {
      // 202 means the student has not approved the code yet; keep polling.
      setError(
        err instanceof ApiError && err.status === 202
          ? 'Waiting for you to approve the code on GitHub…'
          : 'Could not connect GitHub. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function doPublish() {
    setBusy(true);
    setError(null);
    try {
      setPublish(await api.gitPublish(workspaceId));
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 409
          ? 'Start the workspace before publishing.'
          : 'Could not publish to GitHub. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  if (!status) return null;

  if (!status.connected) {
    return (
      <div style={{ marginTop: 12 }}>
        <p className="muted" style={{ marginBottom: 4 }}>
          Publish your code to your own GitHub.
        </p>
        {grant ? (
          <div>
            <p style={{ marginBottom: 4 }}>
              Enter code <strong>{grant.userCode}</strong> at{' '}
              <a href={grant.verificationUri} target="_blank" rel="noreferrer">
                {grant.verificationUri}
              </a>
            </p>
            <button className="btn" onClick={finishConnect} disabled={busy}>
              I’ve authorised — finish connecting
            </button>
          </div>
        ) : (
          <button className="btn" onClick={connect} disabled={busy}>
            Connect GitHub
          </button>
        )}
        {error ? <p className="error">{error}</p> : null}
      </div>
    );
  }

  return (
    <div style={{ marginTop: 12 }}>
      <p className="muted" style={{ marginBottom: 4 }}>
        GitHub: <strong>{status.login}</strong>
      </p>
      {publish?.status === 'succeeded' ? (
        <p style={{ marginBottom: 0 }}>
          Published to{' '}
          <a href={publish.repoUrl} target="_blank" rel="noreferrer">
            {publish.repoFullName} →
          </a>
        </p>
      ) : (
        <button className="btn" onClick={doPublish} disabled={busy}>
          Publish to GitHub
        </button>
      )}
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}

/** The submit form: title, description, and optional GitHub/demo links. */
function SubmissionForm({
  projectId,
  componentId,
  workspaceId,
  maxScore,
  onSubmitted,
}: {
  projectId: string;
  componentId: string;
  workspaceId: string;
  maxScore: number;
  onSubmitted: () => void;
}) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [githubUrl, setGithubUrl] = useState('');
  const [demoUrl, setDemoUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<ProjectSubmission | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.submitProject(projectId, componentId, {
        workspaceId,
        title: title.trim(),
        description: description.trim(),
        githubUrl: githubUrl.trim() || null,
        demoUrl: demoUrl.trim() || null,
      });
      setDone(result);
      onSubmitted();
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 409
          ? 'This project is closed or your workspace is still active. Stop it and try again.'
          : 'Could not submit. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <p className="muted" style={{ marginBottom: 0 }}>
        Submitted “{done.title}” for evaluation (out of {maxScore}). Your trainer
        will review it.
      </p>
    );
  }

  return (
    <form onSubmit={submit}>
      <label htmlFor={`title-${componentId}`}>Submission title</label>
      <input
        id={`title-${componentId}`}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="e.g. Task API with CRUD"
      />
      <label htmlFor={`desc-${componentId}`}>Description</label>
      <input
        id={`desc-${componentId}`}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="What does your project do?"
      />
      <label htmlFor={`gh-${componentId}`}>GitHub URL (optional)</label>
      <input
        id={`gh-${componentId}`}
        value={githubUrl}
        onChange={(e) => setGithubUrl(e.target.value)}
        placeholder="https://github.com/you/repo"
      />
      <label htmlFor={`demo-${componentId}`}>Demo URL (optional)</label>
      <input
        id={`demo-${componentId}`}
        value={demoUrl}
        onChange={(e) => setDemoUrl(e.target.value)}
        placeholder="https://your-demo.example.com"
      />
      {error ? <p className="error">{error}</p> : null}
      <button className="btn" type="submit" disabled={busy || !title.trim()}>
        Submit for evaluation
      </button>
    </form>
  );
}
