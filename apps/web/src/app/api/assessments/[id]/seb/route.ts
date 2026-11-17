import { NextRequest } from 'next/server';
import { proxyBinary } from '@/lib/proxy';

export const dynamic = 'force-dynamic';

/**
 * Safe Exam Browser config download. The `.seb` file is application/seb JSON, so
 * it is forwarded byte-for-byte with its content-disposition intact rather than
 * round-tripped through the text proxy.
 */
export function GET(req: NextRequest, { params }: { params: { id: string } }) {
  return proxyBinary(
    req,
    `/api/assessments/${encodeURIComponent(params.id)}/seb`,
    { method: 'GET' },
  );
}
