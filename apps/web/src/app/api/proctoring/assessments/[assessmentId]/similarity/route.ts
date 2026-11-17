import { NextRequest } from 'next/server';
import { proxy } from '@/lib/proxy';

export const dynamic = 'force-dynamic';

/** Batch-scope code-similarity scan for one graded assessment (§4.2). */
export function GET(
  req: NextRequest,
  { params }: { params: { assessmentId: string } },
) {
  return proxy(
    req,
    `/api/proctoring/assessments/${encodeURIComponent(params.assessmentId)}/similarity`,
  );
}
