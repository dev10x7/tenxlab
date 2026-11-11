import { NextRequest } from 'next/server';
import { proxy } from '@/lib/proxy';

export const dynamic = 'force-dynamic';

export function POST(req: NextRequest) {
  return proxy(req, '/api/auth/logout', { method: 'POST' });
}
