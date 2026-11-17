import { NextRequest } from 'next/server';
import { proxy } from '@/lib/proxy';

export const dynamic = 'force-dynamic';

/** The student dashboard's aggregated view (roadmaps, ranks, profile). */
export function GET(req: NextRequest) {
  return proxy(req, '/api/dashboard');
}
