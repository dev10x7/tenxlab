import { NextRequest } from 'next/server';
import { proxyBinary } from '@/lib/proxy';

export const dynamic = 'force-dynamic';

export function GET(req: NextRequest, { params }: { params: { workspaceId: string } }) {
  return proxyBinary(
    req,
    `/api/projects/workspaces/${encodeURIComponent(params.workspaceId)}/download`,
    { method: 'GET' },
  );
}
