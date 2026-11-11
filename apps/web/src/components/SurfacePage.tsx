import Link from 'next/link';
import { navItemByHref } from '@/lib/nav';

/**
 * Shared shell for a top-level surface that exists in the navigation but whose
 * full feature set lands in a later phase. Keeps every menu entry honest: it
 * states what the surface will do and what already backs it today, rather than
 * linking to a blank page.
 */
export function SurfacePage({
  href,
  title,
  children,
}: {
  href: string;
  title?: string;
  children?: React.ReactNode;
}) {
  const item = navItemByHref(href);
  const heading = title ?? item?.label ?? 'Coming soon';

  return (
    <div>
      <div className="row">
        <h1 style={{ marginBottom: 0 }}>{heading}</h1>
        {item?.phase ? <span className="pill">{item.phase}</span> : null}
      </div>
      <p className="muted" style={{ maxWidth: 640 }}>
        {item?.blurb}
      </p>

      {children}

      <div className="card" style={{ marginTop: 24 }}>
        <h3 style={{ marginTop: 0 }}>Status</h3>
        <p className="muted" style={{ marginBottom: 0 }}>
          This surface is part of the ByteXL-parity roadmap and is not wired to
          the API yet. The backend capabilities it will use are tracked in{' '}
          <code>docs/BYTEXL_PARITY_ANALYSIS.md</code>.
        </p>
      </div>

      <p className="muted" style={{ marginTop: 16 }}>
        <Link href="/dashboard">← Back to dashboard</Link>
      </p>
    </div>
  );
}
