import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { LabLaunchJwtPayload, RuntimeTier } from '@tenxlab/contracts';

export interface JwtKeys {
  privateKey: string;
  publicKey: string;
  kid: string;
}

export interface LaunchClaimsInput {
  userId: string;
  tenantId: string;
  membershipRole: LabLaunchJwtPayload['membership_role'];
  exerciseId: string;
  runtimeTier: RuntimeTier;
  sessionId: string;
  callbackUrl: string;
  batchId?: string;
  courseId?: string;
}

/**
 * Issues and verifies the RS256 launch JWT used by KubeLab and the AI plane.
 * The public key is published via JWKS so consumers verify without a shared
 * secret.
 */
export class JwtService {
  constructor(
    private readonly keys: JwtKeys,
    private readonly ttlSeconds: number,
  ) {}

  issueLaunchToken(input: LaunchClaimsInput, now = Date.now()): string {
    const iat = Math.floor(now / 1000);
    const payload = {
      iss: 'tenxlms' as const,
      sub: input.userId,
      aud: 'kubelab',
      tenant_id: input.tenantId,
      membership_role: input.membershipRole,
      batch_id: input.batchId,
      course_id: input.courseId,
      exercise_id: input.exerciseId,
      runtime_tier: input.runtimeTier,
      session_id: input.sessionId,
      callback_url: input.callbackUrl,
      iat,
      exp: iat + this.ttlSeconds,
      jti: randomUUID(),
    };
    return jwt.sign(payload, this.keys.privateKey, {
      algorithm: 'RS256',
      keyid: this.keys.kid,
    });
  }

  verifyLaunchToken(token: string): LabLaunchJwtPayload {
    const decoded = jwt.verify(token, this.keys.publicKey, {
      algorithms: ['RS256'],
      issuer: 'tenxlms',
      audience: 'kubelab',
    });
    return decoded as LabLaunchJwtPayload;
  }

  /** JWKS document for consumers (KubeLab, AI plane) to verify tokens. */
  jwks(): { keys: Array<Record<string, unknown>> } {
    return { keys: [pemToJwk(this.keys.publicKey, this.keys.kid)] };
  }
}

/**
 * Minimal RS256 JWK export from a PEM public key (SubjectPublicKeyInfo).
 * Avoids pulling a JWK library for a single, well-specified conversion.
 */
export function pemToJwk(publicKeyPem: string, kid: string) {
  const der = Buffer.from(
    publicKeyPem
      .replace(/-----BEGIN PUBLIC KEY-----/, '')
      .replace(/-----END PUBLIC KEY-----/, '')
      .replace(/\s+/g, ''),
    'base64',
  );

  let offset = 0;
  const readLength = (): number => {
    let len = der[offset++] as number;
    if (len & 0x80) {
      const numBytes = len & 0x7f;
      len = 0;
      for (let i = 0; i < numBytes; i++) len = (len << 8) | (der[offset++] as number);
    }
    return len;
  };
  const readTag = () => {
    offset++; // tag byte (assumed SEQUENCE/INTEGER/BIT STRING as expected)
    const len = readLength();
    const start = offset;
    return { len, start };
  };

  readTag(); // outer SEQUENCE (SPKI)
  const alg = readTag(); // AlgorithmIdentifier SEQUENCE
  offset = alg.start + alg.len;
  const bitStr = readTag(); // BIT STRING
  offset = bitStr.start + 1; // skip the unused-bits octet

  readTag(); // RSAPublicKey SEQUENCE
  const modInt = readTag(); // INTEGER modulus
  const modulus = der.subarray(modInt.start, modInt.start + modInt.len);
  offset = modInt.start + modInt.len;
  const expInt = readTag(); // INTEGER exponent
  const exponent = der.subarray(expInt.start, expInt.start + expInt.len);

  return {
    kty: 'RSA',
    use: 'sig',
    alg: 'RS256',
    kid,
    n: b64url(modulus),
    e: b64url(exponent),
  };
}

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}
