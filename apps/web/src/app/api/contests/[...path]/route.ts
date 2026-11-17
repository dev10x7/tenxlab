import { NextRequest } from 'next/server';
import { proxy } from '@/lib/proxy';

export const dynamic = 'force-dynamic';

/** Contests passthrough (list, detail, publish, leaderboard, entries). */
function forward(req: NextRequest, path: string[]) {
  return proxy(req, `/api/contests/${path.map(encodeURIComponent).join('/')}`);
}

export function GET(req: NextRequest, { params }: { params: { path: string[] } }) {
  return forward(req, params.path);
}

export function POST(req: NextRequest, { params }: { params: { path: string[] } }) {
  return forward(req, params.path);
}
