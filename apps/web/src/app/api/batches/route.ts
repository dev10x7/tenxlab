import { NextRequest } from 'next/server';
import { proxy } from '@/lib/proxy';

export const dynamic = 'force-dynamic';

export function GET(req: NextRequest) {
  return proxy(req, '/api/batches');
}

export function POST(req: NextRequest) {
  return proxy(req, '/api/batches', { method: 'POST' });
}
