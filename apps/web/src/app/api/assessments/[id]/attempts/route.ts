import { NextRequest } from 'next/server';
import { proxy } from '@/lib/proxy';

export const dynamic = 'force-dynamic';

export function POST(req: NextRequest, { params }: { params: { id: string } }) {
  return proxy(req, `/api/assessments/${encodeURIComponent(params.id)}/attempts`, {
    method: 'POST',
  });
}
