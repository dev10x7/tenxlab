import { NextRequest } from 'next/server';
import { proxy } from '@/lib/proxy';

export const dynamic = 'force-dynamic';

/** Student Reports passthrough (batch roll-ups). */
function forward(req: NextRequest, path: string[]) {
  return proxy(req, `/api/reports/${path.map(encodeURIComponent).join('/')}`);
}

export function GET(req: NextRequest, { params }: { params: { path: string[] } }) {
  return forward(req, params.path);
}
