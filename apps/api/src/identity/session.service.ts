import { createHmac, timingSafeEqual } from 'node:crypto';

export interface SessionPayload {
  userId: string;
  tenantId: string;
  role: 'student' | 'instructor' | 'admin';
  displayName: string;
}

/**
 * Signs and verifies the browser session cookie.
 *
 * The payload is base64url-encoded JSON followed by an HMAC-SHA256 tag over
 * that payload, so a tampered cookie fails verification rather than being
 * trusted. This is deliberately small: the cookie carries no secrets, only the
 * identity the API already knows.
 */
export class SessionService {
  constructor(
    private readonly secret: string,
    private readonly cookieName = 'tenxlab_session',
  ) {}

  get name(): string {
    return this.cookieName;
  }

  sign(payload: SessionPayload): string {
    const body = base64url(Buffer.from(JSON.stringify(payload), 'utf8'));
    return `${body}.${this.tag(body)}`;
  }

  verify(cookie: string | undefined | null): SessionPayload | null {
    if (!cookie) return null;
    const idx = cookie.lastIndexOf('.');
    if (idx <= 0) return null;
    const body = cookie.slice(0, idx);
    const tag = cookie.slice(idx + 1);
    if (!constantTimeEquals(tag, this.tag(body))) return null;
    try {
      return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
    } catch {
      return null;
    }
  }

  /** Parse a Cookie header and return the verified session, if any. */
  fromCookieHeader(header: string | undefined): SessionPayload | null {
    if (!header) return null;
    for (const part of header.split(';')) {
      const [k, ...rest] = part.trim().split('=');
      if (k === this.cookieName) {
        return this.verify(decodeURIComponent(rest.join('=')));
      }
    }
    return null;
  }

  /** Set-Cookie value that expires the session. */
  clearCookie(): string {
    return `${this.cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
  }

  /** Set-Cookie value that stores the signed session. */
  setCookie(payload: SessionPayload, maxAgeSeconds = 60 * 60 * 8): string {
    const value = encodeURIComponent(this.sign(payload));
    return `${this.cookieName}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
  }

  private tag(body: string): string {
    return base64url(createHmac('sha256', this.secret).update(body).digest());
  }
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function constantTimeEquals(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
