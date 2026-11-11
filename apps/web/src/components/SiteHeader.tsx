import Link from 'next/link';

export function SiteHeader() {
  return (
    <header className="topbar">
      <Link href="/" className="brand">
        TenX<span>Lab</span>
      </Link>
      <nav className="row" style={{ gap: 16 }}>
        <Link href="/dashboard">Dashboard</Link>
        <Link href="/catalog">Catalog</Link>
        <Link href="/login">Sign in</Link>
      </nav>
    </header>
  );
}
