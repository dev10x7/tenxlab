'use client';

import { Suspense } from 'react';
import { LoginForm } from '@/components/LoginForm';

export default function LoginPage() {
  return (
    <Suspense
      fallback={<p className="muted" style={{ marginTop: 40 }}>Loading…</p>}
    >
      <LoginForm />
    </Suspense>
  );
}
