import { NextRequest } from 'next/server';
import { proxy } from '@/lib/proxy';

export const dynamic = 'force-dynamic';

/** Contests root: list the visible contests, or author a new one. */
export function GET(req: NextRequest) {
  return proxy(req, '/api/contests');
}

export function POST(req: NextRequest) {
  return proxy(req, '/api/contests');
}
