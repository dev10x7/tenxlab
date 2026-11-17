import { NextRequest } from 'next/server';
import { proxy } from '@/lib/proxy';

export const dynamic = 'force-dynamic';

/** Clarity root: submit a response for CEFR scoring. */
export function POST(req: NextRequest) {
  return proxy(req, '/api/clarity');
}
