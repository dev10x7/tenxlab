import { NextRequest } from 'next/server';
import { proxy } from '@/lib/proxy';

export const dynamic = 'force-dynamic';

export function GET(req: NextRequest, { params }: { params: { id: string } }) {
  return proxy(req, `/api/editor/snippets/${encodeURIComponent(params.id)}`);
}

export function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  return proxy(req, `/api/editor/snippets/${encodeURIComponent(params.id)}`, {
    method: 'PATCH',
  });
}

export function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  return proxy(req, `/api/editor/snippets/${encodeURIComponent(params.id)}`, {
    method: 'DELETE',
  });
}
