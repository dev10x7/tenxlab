import { NextRequest } from 'next/server';
import { proxy } from '@/lib/proxy';

export const dynamic = 'force-dynamic';

export function POST(req: NextRequest, { params }: { params: { attemptId: string } }) {
  return proxy(
    req,
    `/api/proctoring/attempts/${encodeURIComponent(params.attemptId)}/events`,
    { method: 'POST' },
  );
}
