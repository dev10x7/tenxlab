'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, type Session } from '@/lib/api';
import { navSections, activeHref } from '@/lib/nav';

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
    <div className="shell">
      <aside className="sidebar">
        <Link href="/" className="brand sidebar-brand">
          TenX<span>Lab</span>
        </Link>
        <nav className="sidebar-nav">
          {sections.map((section) => (
            <div key={section.title} className="nav-section">
              <p className="nav-section-title">{section.title}</p>
              {section.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`nav-link${current === item.href ? ' active' : ''}`}
                >
                  <span className="nav-icon" aria-hidden>
                    {item.icon}
                  </span>
                  <span>{item.label}</span>
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
