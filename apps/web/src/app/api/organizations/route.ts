import { NextRequest } from 'next/server';
import { proxy } from '@/lib/proxy';

export const dynamic = 'force-dynamic';

// The bare collection path; the sibling [...path] route handles departments.
export function GET(req: NextRequest) {
  return proxy(req, '/api/organizations');
}
