import { NextRequest } from 'next/server';
import { proxy } from '@/lib/proxy';

export const dynamic = 'force-dynamic';

export function PATCH(
  req: NextRequest,
  { params }: { params: { submissionId: string } },
) {
  return proxy(req, `/api/projects/submissions/${encodeURIComponent(params.submissionId)}`, {
    method: 'PATCH',
  });
}
