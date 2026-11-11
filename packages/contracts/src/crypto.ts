import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Compute an HMAC-SHA256 hex digest over a raw request body.
 * Used to sign outbound webhooks and verify inbound ones.
 */
export function hmacSha256Hex(secret: string, body: string | Buffer): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

/**
 * Constant-time comparison of two hex signatures. Returns false on length
 * mismatch rather than throwing, so callers can treat it as a normal failure.
 */
export function verifyHmacSha256(
  secret: string,
  body: string | Buffer,
  providedHex: string | undefined,
): boolean {
  if (!providedHex) return false;
  const expected = Buffer.from(hmacSha256Hex(secret, body), 'hex');
  let provided: Buffer;
  try {
    provided = Buffer.from(providedHex, 'hex');
  } catch {
    return false;
  }
  if (expected.length !== provided.length) return false;
  return timingSafeEqual(expected, provided);
}
