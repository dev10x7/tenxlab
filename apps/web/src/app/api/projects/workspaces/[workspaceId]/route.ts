import { NextRequest } from 'next/server';
import { proxy } from '@/lib/proxy';

export const dynamic = 'force-dynamic';

export function DELETE(req: NextRequest, { params }: { params: { workspaceId: string } }) {
  return proxy(req, `/api/projects/workspaces/${encodeURIComponent(params.workspaceId)}`, {
    method: 'DELETE',
  });
}
