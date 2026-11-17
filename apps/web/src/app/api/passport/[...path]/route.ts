import { NextRequest } from 'next/server';
import { proxy } from '@/lib/proxy';

export const dynamic = 'force-dynamic';

/** Skill Passport passthrough (own passport, recruiter shortlist). */
function forward(req: NextRequest, path: string[]) {
  return proxy(req, `/api/passport/${path.map(encodeURIComponent).join('/')}`);
}

export function GET(req: NextRequest, { params }: { params: { path: string[] } }) {
  return forward(req, params.path);
}
