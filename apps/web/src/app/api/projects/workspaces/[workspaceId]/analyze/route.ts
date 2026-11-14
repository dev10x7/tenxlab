import { NextRequest } from 'next/server';
import { proxy } from '@/lib/proxy';

export const dynamic = 'force-dynamic';

/** Auto-evaluate (E4): score the workspace's source with the AI plane. */
export function POST(req: NextRequest, { params }: { params: { workspaceId: string } }) {
  return proxy(
    req,
    `/api/projects/workspaces/${encodeURIComponent(params.workspaceId)}/analyze`,
    { method: 'POST' },
  );
}
