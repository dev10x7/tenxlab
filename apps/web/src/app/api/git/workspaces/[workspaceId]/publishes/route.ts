import { NextRequest } from 'next/server';
import { proxy } from '@/lib/proxy';

export const dynamic = 'force-dynamic';

/** The caller's publish history for a workspace. */
export function GET(req: NextRequest, { params }: { params: { workspaceId: string } }) {
  return proxy(
    req,
    `/api/git/workspaces/${encodeURIComponent(params.workspaceId)}/publishes`,
  );
}
