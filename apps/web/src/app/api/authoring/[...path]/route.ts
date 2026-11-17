import { NextRequest } from 'next/server';
import { proxy } from '@/lib/proxy';

export const dynamic = 'force-dynamic';

/**
 * Authoring passthrough. The instructor course editor drives a small REST
 * surface (courses, modules, lessons, publish) under one prefix, so a single
 * catch-all proxy keeps every verb — including PATCH and DELETE — forwarded to
 * the API with the session cookie, rather than one file per resource.
 */
function forward(req: NextRequest, path: string[]) {
  return proxy(req, `/api/authoring/${path.map(encodeURIComponent).join('/')}`);
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
