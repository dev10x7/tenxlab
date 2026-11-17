import { NextRequest } from 'next/server';
import { proxy } from '@/lib/proxy';

export const dynamic = 'force-dynamic';

// The bare collection path; the sibling [...path] route handles the rest.
export function GET(req: NextRequest) {
  return proxy(req, '/api/question-bank');
}

export function POST(req: NextRequest) {
  return proxy(req, '/api/question-bank', { method: 'POST' });
}
