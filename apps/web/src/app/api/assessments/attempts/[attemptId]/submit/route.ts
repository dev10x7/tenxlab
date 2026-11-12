import { NextRequest } from 'next/server';
import { proxy } from '@/lib/proxy';

export const dynamic = 'force-dynamic';

export function POST(req: NextRequest, { params }: { params: { attemptId: string } }) {
  return proxy(
    req,
    `/api/assessments/attempts/${encodeURIComponent(params.attemptId)}/submit`,
    { method: 'POST' },
  );
}
