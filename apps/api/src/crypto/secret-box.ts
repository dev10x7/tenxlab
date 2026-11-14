import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Symmetric encryption for third-party tokens held at rest.
 *
 * A student's GitHub access token authorises pushes to their account, so it is
 * stored encrypted rather than in the clear: the LMS only ever needs to decrypt
 * it for the duration of a push. AES-256-GCM gives confidentiality and an
 * authentication tag, so a tampered ciphertext fails to decrypt rather than
 * yielding a corrupted token. The key is derived from a configured secret, so
 * rotating that secret invalidates old ciphertexts (they must be reconnected).
 */
export class SecretBox {
  private readonly key: Buffer;

  constructor(secret: string) {
    // A 32-byte key from any secret string; the secret itself is never stored.
    this.key = createHash('sha256').update(secret).digest();
  }

  /** Encrypt a UTF-8 string to a single `v1.<iv>.<tag>.<ciphertext>` token. */
  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ['v1', iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.');
  }

  /** Decrypt a token produced by `encrypt`. Throws if it was tampered with. */
  decrypt(payload: string): string {
    const [version, ivB64, tagB64, dataB64] = payload.split('.');
    if (version !== 'v1' || !ivB64 || !tagB64 || !dataB64) {
      throw new Error('secret-box: unrecognised ciphertext');
    }
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivB64, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64url'));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }
}
