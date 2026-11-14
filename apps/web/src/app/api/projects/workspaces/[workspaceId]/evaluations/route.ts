import { NextRequest } from 'next/server';
import { proxy } from '@/lib/proxy';

export const dynamic = 'force-dynamic';

/** A workspace's auto-evaluation history, newest first. */
export function GET(req: NextRequest, { params }: { params: { workspaceId: string } }) {
  return proxy(
    req,
    `/api/projects/workspaces/${encodeURIComponent(params.workspaceId)}/evaluations`,
    { method: 'GET' },
  );
}
