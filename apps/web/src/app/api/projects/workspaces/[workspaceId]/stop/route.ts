import { NextRequest } from 'next/server';
import { proxy } from '@/lib/proxy';

export const dynamic = 'force-dynamic';

export function POST(req: NextRequest, { params }: { params: { workspaceId: string } }) {
  return proxy(
    req,
    `/api/projects/workspaces/${encodeURIComponent(params.workspaceId)}/stop`,
    { method: 'POST' },
  );
}
