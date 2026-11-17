import { NextRequest } from 'next/server';
import { proxy } from '@/lib/proxy';

export const dynamic = 'force-dynamic';

/**
 * Support passthrough. One catch-all covers filing a report (POST /issues) and
 * the support-desk queue (GET /issues, PATCH /issues/:id) with the session
 * cookie forwarded, instead of a file per resource.
 */
function forward(req: NextRequest, path: string[]) {
  return proxy(req, `/api/support/${path.map(encodeURIComponent).join('/')}`);
}

export function GET(req: NextRequest, { params }: { params: { path: string[] } }) {
  return forward(req, params.path);
}

export function POST(req: NextRequest, { params }: { params: { path: string[] } }) {
  return forward(req, params.path);
}

export function PATCH(req: NextRequest, { params }: { params: { path: string[] } }) {
  return forward(req, params.path);
}
