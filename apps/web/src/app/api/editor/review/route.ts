import { NextRequest } from 'next/server';
import { proxy } from '@/lib/proxy';

export const dynamic = 'force-dynamic';

/** AI tutor review (parity §1.6): assist/socratic review of the editor buffer. */
export function POST(req: NextRequest) {
  return proxy(req, '/api/editor/review', { method: 'POST' });
}
