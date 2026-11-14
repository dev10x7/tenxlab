import { NextRequest } from 'next/server';
import { proxy } from '@/lib/proxy';

export const dynamic = 'force-dynamic';

/** Tenant cost and quota for the current billing period. */
export function GET(req: NextRequest) {
  return proxy(req, '/api/labs/usage');
}
