import { NextRequest } from 'next/server';
import { proxy } from '@/lib/proxy';

export const dynamic = 'force-dynamic';

export function GET(req: NextRequest, { params }: { params: { forkId: string } }) {
  return proxy(req, `/api/projects/forks/${encodeURIComponent(params.forkId)}`);
}
