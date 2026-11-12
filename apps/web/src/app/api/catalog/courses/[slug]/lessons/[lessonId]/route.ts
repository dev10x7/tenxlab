import { NextRequest } from 'next/server';
import { proxy } from '@/lib/proxy';

export const dynamic = 'force-dynamic';

export function GET(
  req: NextRequest,
  { params }: { params: { slug: string; lessonId: string } },
) {
  return proxy(
    req,
    `/api/catalog/courses/${encodeURIComponent(params.slug)}/lessons/${encodeURIComponent(params.lessonId)}`,
  );
}
