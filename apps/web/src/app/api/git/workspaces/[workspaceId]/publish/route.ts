import { NextRequest } from 'next/server';
import { proxy } from '@/lib/proxy';

export const dynamic = 'force-dynamic';

/** Publish a running workspace to the student's GitHub. */
export function POST(req: NextRequest, { params }: { params: { workspaceId: string } }) {
  return proxy(
    req,
    `/api/git/workspaces/${encodeURIComponent(params.workspaceId)}/publish`,
    { method: 'POST' },
  );
}
