'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, type Session } from '@/lib/api';
import { navSections, activeHref, helpHref } from '@/lib/nav';

const COLLAPSE_KEY = 'tenxlab.sidebar.collapsed';

/**
 * Persistent app chrome: a ByteXL-style left sidebar of role-aware sections plus
 * a top bar with the current user. The session is fetched client-side so the
 * shell can stay a client component while pages remain server-rendered.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  // Restore the sidebar preference after mount so server and client markup match.
  useEffect(() => {
    setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === '1');
  }, []);

  useEffect(() => {
    let active = true;
    api
      .session()
      .then((s) => active && setSession(s))
      .catch(() => active && setSession(null))
      .finally(() => active && setLoaded(true));
    return () => {
      active = false;
    };
    // Re-read on navigation: the shell persists across routes, so a sign-in or
    // sign-out elsewhere would otherwise leave the top bar stale.
  }, [pathname]);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      window.localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      return next;
    });
  }

  const sections = navSections(session?.role);
  const current = activeHref(pathname, session?.role);

  async function signOut() {
    try {
      await api.logout();
    } finally {
      router.push('/login');
    }
  }

  // The sign-in page renders without app chrome: there is no session yet, and
  // a sidebar of destinations the visitor cannot reach would be noise.
  if (pathname === '/login') {
    return <main className="container">{children}</main>;
  }

  return (
    <div className={`shell${collapsed ? ' sidebar-collapsed' : ''}`}>
      <aside className="sidebar">
        <div className="sidebar-head">
          <Link href="/" className="brand sidebar-brand" title="TenXLab">
            TenX<span>Lab</span>
          </Link>
          <button
            className="sidebar-toggle"
            onClick={toggleCollapsed}
            aria-label={collapsed ? 'Expand menu' : 'Collapse menu'}
            aria-expanded={!collapsed}
            title={collapsed ? 'Expand menu' : 'Collapse menu'}
          >
            <span aria-hidden>{collapsed ? '»' : '«'}</span>
          </button>
        </div>
        <nav className="sidebar-nav">
          {sections.map((section) => (
            <div key={section.title} className="nav-section">
              <p className="nav-section-title">{section.title}</p>
              {section.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`nav-link${current === item.href ? ' active' : ''}`}
                  title={collapsed ? item.label : undefined}
                >
                  <span className="nav-icon" aria-hidden>
                    {item.icon}
                  </span>
                  <span className="nav-label">{item.label}</span>
                  {item.phase ? (
                    <span className="nav-badge" title={`Arrives in ${item.phase}`}>
                      {item.phase}
                    </span>
                  ) : null}
                </Link>
              ))}
            </div>
          ))}
        </nav>
      </aside>

      <div className="shell-main">
        <header className="topbar">
          <div className="row" style={{ gap: 12 }}>
            <span className="muted">Hands-on cloud &amp; DevOps labs</span>
          </div>
          <div className="row" style={{ gap: 12, justifyContent: 'flex-end' }}>
            {loaded && session ? (
              <>
                <Link
                  className="topbar-action"
                  href={helpHref(session.role)}
                  title="Help & guides"
                  aria-label="Help and guides"
                >
                  <span aria-hidden>?</span>
                </Link>
                <Link
                  className="topbar-action"
                  href="/notifications"
                  title="Notifications"
                  aria-label="Notifications"
                >
                  <span aria-hidden>🔔</span>
                </Link>
                <Link
                  className="topbar-action"
                  href="/settings"
                  title="Platform settings"
                  aria-label="Platform settings"
                >
                  <span aria-hidden>⚙</span>
                </Link>
                <span className="pill">{session.role}</span>
                <span>{session.displayName}</span>
                <button className="btn secondary" onClick={signOut}>
                  Sign out
                </button>
              </>
            ) : loaded ? (
              <Link className="btn" href="/login">
                Sign in
              </Link>
            ) : null}
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
