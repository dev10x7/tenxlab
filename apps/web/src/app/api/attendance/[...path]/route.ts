import { NextRequest } from 'next/server';
import { proxy } from '@/lib/proxy';

export const dynamic = 'force-dynamic';

/**
 * Attendance passthrough. The `/classes` surface drives a small REST prefix
 * (own attendance, a batch's sessions and matrix, session marking), so one
 * catch-all keeps every verb — including PATCH — forwarded to the API with the
 * session cookie instead of one file per resource.
 */
function forward(req: NextRequest, path: string[]) {
  return proxy(req, `/api/attendance/${path.map(encodeURIComponent).join('/')}`);
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

export function DELETE(req: NextRequest, { params }: { params: { path: string[] } }) {
  return forward(req, params.path);
}
