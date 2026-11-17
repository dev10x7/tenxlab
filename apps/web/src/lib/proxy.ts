import { NextRequest, NextResponse } from 'next/server';
import { methodHasBody, proxyFetchInit, withQuery } from './lms';

const API_BASE = process.env.API_BASE_URL ?? 'http://localhost:4000';

/**
 * Proxy a browser request to the NestJS API, forwarding the session cookie and
 * the raw body. Keeping this server-side avoids CORS and keeps the session
 * cookie same-origin. The browser request's query string is preserved so
 * filters and pagination reach the API.
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

  const method = init.method ?? req.method;

  const body = methodHasBody(method) ? await req.text() : undefined;

  const upstream = await fetch(
    `${API_BASE}${withQuery(path, req.nextUrl.search)}`,
    proxyFetchInit({
      method,
      headers,
      body,
    }),
  );

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

/**
 * Proxy a browser request whose response is binary (e.g. a workspace download).
 *
 * The text-based `proxy` above would corrupt a tar.gz by decoding it as UTF-8,
 * so this variant forwards the raw bytes and the download headers untouched.
 */
export async function proxyBinary(
  req: NextRequest,
  path: string,
  init: { method?: string } = {},
): Promise<NextResponse> {
  const headers = new Headers();
  const cookie = req.headers.get('cookie');
  if (cookie) headers.set('cookie', cookie);

  const method = init.method ?? req.method;

  const upstream = await fetch(`${API_BASE}${withQuery(path, req.nextUrl.search)}`, {
    method,
    headers,
  });

  const responseHeaders = new Headers();
  const setCookie = upstream.headers.get('set-cookie');
  if (setCookie) responseHeaders.set('set-cookie', setCookie);
  const upstreamType = upstream.headers.get('content-type');
  if (upstreamType) responseHeaders.set('content-type', upstreamType);
  const disposition = upstream.headers.get('content-disposition');
  if (disposition) responseHeaders.set('content-disposition', disposition);

  if (upstream.status === 204) {
    return new NextResponse(null, { status: 204, headers: responseHeaders });
  }

  const bytes = await upstream.arrayBuffer();
  return new NextResponse(bytes, {
    status: upstream.status,
    headers: responseHeaders,
  });
}
