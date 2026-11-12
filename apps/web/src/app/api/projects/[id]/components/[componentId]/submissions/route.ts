import { NextRequest } from 'next/server';
import { proxy } from '@/lib/proxy';

export const dynamic = 'force-dynamic';

export function POST(
  req: NextRequest,
  { params }: { params: { id: string; componentId: string } },
) {
  return proxy(
    req,
    `/api/projects/${encodeURIComponent(params.id)}/components/${encodeURIComponent(params.componentId)}/submissions`,
    { method: 'POST' },
  );
}
