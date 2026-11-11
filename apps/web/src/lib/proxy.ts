import { NextRequest, NextResponse } from 'next/server';

const API_BASE = process.env.API_BASE_URL ?? 'http://localhost:4000';

/**
 * Proxy a browser request to the NestJS API, forwarding the session cookie and
 * the raw body. Keeping this server-side avoids CORS and keeps the session
 * cookie same-origin.
 */
export async function proxy(
  req: NextRequest,
  path: string,
  init: { method?: string } = {},
): Promise<NextResponse> {
  const headers = new Headers();
  const contentType = req.headers.get('content-type');
  if (contentType) headers.set('content-type', contentType);
  const cookie = req.headers.get('cookie');
  if (cookie) headers.set('cookie', cookie);

  const body =
    init.method && init.method !== 'GET' && init.method !== 'HEAD'
      ? await req.text()
      : undefined;

  const upstream = await fetch(`${API_BASE}${path}`, {
    method: init.method ?? req.method,
    headers,
    body,
    redirect: 'manual',
  });

  const responseHeaders = new Headers();
  const setCookie = upstream.headers.get('set-cookie');
  if (setCookie) responseHeaders.set('set-cookie', setCookie);
  const upstreamType = upstream.headers.get('content-type');
  if (upstreamType) responseHeaders.set('content-type', upstreamType);

  if (upstream.status === 204) {
    return new NextResponse(null, { status: 204, headers: responseHeaders });
  }

  const text = await upstream.text();
  return new NextResponse(text, {
    status: upstream.status,
    headers: responseHeaders,
  });
}
