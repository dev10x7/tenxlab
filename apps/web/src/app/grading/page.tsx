'use client';

import { Suspense } from 'react';
import { GradebookView } from '@/components/GradebookView';

export default function GradingPage() {
  return (
    <Suspense fallback={<p className="muted">Loading gradebook…</p>}>
      <GradebookView />
    </Suspense>
  );
}
