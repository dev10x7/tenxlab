import { NextRequest } from 'next/server';
import { proxy } from '@/lib/proxy';

export const dynamic = 'force-dynamic';

/** Disconnect the caller's GitHub account. */
export function DELETE(req: NextRequest) {
  return proxy(req, '/api/git/connect', { method: 'DELETE' });
}
