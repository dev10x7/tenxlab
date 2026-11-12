import { NextRequest } from 'next/server';
import { proxy } from '@/lib/proxy';

export const dynamic = 'force-dynamic';

export function GET(req: NextRequest) {
  return proxy(req, '/api/editor/snippets');
}

export function POST(req: NextRequest) {
  return proxy(req, '/api/editor/snippets', { method: 'POST' });
}
