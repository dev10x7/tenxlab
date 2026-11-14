import { NextRequest } from 'next/server';
import { proxy } from '@/lib/proxy';

export const dynamic = 'force-dynamic';

/** Deploy (E5): expose the workspace's service on a public URL. */
export function POST(req: NextRequest, { params }: { params: { workspaceId: string } }) {
  return proxy(
    req,
    `/api/projects/workspaces/${encodeURIComponent(params.workspaceId)}/deploy`,
    { method: 'POST' },
  );
}

/** Withdraw the workspace's exposed service. */
export function DELETE(req: NextRequest, { params }: { params: { workspaceId: string } }) {
  return proxy(
    req,
    `/api/projects/workspaces/${encodeURIComponent(params.workspaceId)}/deploy`,
    { method: 'DELETE' },
  );
}
