import { NextRequest } from 'next/server';
import { proxy } from '@/lib/proxy';

export const dynamic = 'force-dynamic';

export function GET(req: NextRequest, { params }: { params: { id: string } }) {
  return proxy(req, `/api/projects/${encodeURIComponent(params.id)}`);
}
