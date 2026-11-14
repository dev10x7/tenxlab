import { NextRequest } from 'next/server';
import { proxy } from '@/lib/proxy';

export const dynamic = 'force-dynamic';

/** Begin a GitHub device-flow connection. */
export function POST(req: NextRequest) {
  return proxy(req, '/api/git/connect/start', { method: 'POST' });
}
