import { NextRequest } from 'next/server';
import { proxy } from '@/lib/proxy';

export const dynamic = 'force-dynamic';

/** The caller's GitHub connection state. */
export function GET(req: NextRequest) {
  return proxy(req, '/api/git/status');
}
