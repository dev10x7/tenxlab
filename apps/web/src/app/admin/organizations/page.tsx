'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, ApiError, type OrganizationView } from '@/lib/api';
import { formatUsd } from '@/lib/lms';

/**
 * Organizations — the admin console (ByteXL parity §2.2).
 *
 * An admin sees the tenant's identity and limits, its roster headcounts, and
 * its departments, and can add or remove departments. The API is admin-only, so
 * an instructor who reaches the route gets a clear message rather than data.
 */
export default function AdminOrganizationsPage() {
  const [role, setRole] = useState<'student' | 'instructor' | 'admin' | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api
      .session()
      .then((s) => setRole(s?.role ?? null))
      .catch(() => setRole(null))
      .finally(() => setLoaded(true));
  }, []);

  if (!loaded) return <p className="muted">Loading organizations…</p>;
  if (!role) return <p className="error">Please sign in.</p>;
  if (role !== 'admin') {
    return (
      <div>
        <h1>Organizations</h1>
        <p className="muted">The admin console is available to admins only.</p>
      </div>
    );
  }

  return <OrgView />;
}

function OrgView() {
  const [org, setOrg] = useState<OrganizationView | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setOrg(await api.organization());
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 403
          ? 'The admin console is available to admins only.'
          : 'Could not load the organization.',
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.createDepartment(name.trim());
      setName('');
      await load();
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 400
          ? 'That department already exists.'
          : 'Could not create the department.',
      );
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await api.deleteDepartment(id);
      await load();
    } catch {
      setError('Could not delete the department.');
    }
  };

  if (error && !org) return <p className="error">{error}</p>;
  if (!org) return <p className="muted">Loading organization…</p>;

  return (
    <div>
      <h1>Organizations</h1>
      <p className="muted" style={{ maxWidth: 640 }}>
        Your institution: its plan and limits, its people, and its departments.
      </p>

      {error ? <p className="error">{error}</p> : null}

      <div className="card" style={{ marginTop: 16 }}>
        <h3 style={{ marginTop: 0 }}>{org.tenant.name}</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          {org.tenant.domain} · {org.tenant.plan} plan · {org.tenant.status}
        </p>
        <div className="row" style={{ gap: 24, flexWrap: 'wrap' }}>
          <Stat label="Members" value={String(org.members.total)} />
          <Stat label="Students" value={String(org.members.students)} />
          <Stat label="Instructors" value={String(org.members.instructors)} />
          <Stat label="Admins" value={String(org.members.admins)} />
          <Stat label="Batches" value={String(org.batchCount)} />
          <Stat label="Concurrent labs" value={String(org.tenant.maxConcurrentLabs)} />
          <Stat
            label="Monthly budget"
            value={
              org.tenant.monthlyBudgetCents === 0
                ? 'Unlimited'
                : formatUsd(org.tenant.monthlyBudgetCents)
            }
          />
          <Stat
            label="Storage cap"
            value={org.tenant.maxStorageGb === 0 ? 'Unlimited' : `${org.tenant.maxStorageGb} GB`}
          />
        </div>
      </div>

      <section style={{ marginTop: 32 }}>
        <h2>Departments</h2>
        <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
          <label style={{ flex: 1, maxWidth: 320 }}>
            <div className="muted" style={{ fontSize: 12 }}>
              New department
            </div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Computer Science"
              disabled={busy}
            />
          </label>
          <button onClick={() => void add()} disabled={busy || !name.trim()}>
            {busy ? 'Adding…' : 'Add'}
          </button>
        </div>

        {org.departments.length === 0 ? (
          <p className="muted" style={{ marginTop: 16 }}>
            No departments yet.
          </p>
        ) : (
          <table className="gradebook" style={{ marginTop: 16 }}>
            <thead>
              <tr>
                <th>Department</th>
                <th>Batches</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {org.departments.map((d) => (
                <tr key={d.id}>
                  <td>{d.name}</td>
                  <td>{d.batchCount}</td>
                  <td>
                    <button onClick={() => void remove(d.id)}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="muted" style={{ fontSize: 12 }}>
        {label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 600 }}>{value}</div>
    </div>
  );
}
