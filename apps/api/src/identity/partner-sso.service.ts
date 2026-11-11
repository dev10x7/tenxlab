import jwt from 'jsonwebtoken';
import { PartnerSsoClaims } from '@tenxlab/contracts';
import type { ReplayGuard, TenantRepository, UserRepository, MembershipRepository } from '../common/ports';

export type PartnerSsoResult =
  | {
      ok: true;
      user: { id: string; email: string; fullName: string };
      tenantId: string;
      role: string;
    }
  | { ok: false; reason: PartnerSsoErrorReason };

export type PartnerSsoErrorReason =
  | 'invalid_signature'
  | 'token_expired'
  | 'replay_detected'
  | 'unknown_partner'
  | 'user_not_found';

export interface PartnerSsoOptions {
  /** partnerId -> shared HS256 secret. */
  secrets: Record<string, string>;
  /** When true, unknown emails are provisioned on first login. */
  jitProvisioning?: boolean;
  /** Max token age in seconds (defence in depth beyond exp). */
  maxAgeSeconds?: number;
}

/**
 * Verifies a partner SSO token (HS256 signed-token redirect, ByteXL-compatible)
 * and resolves the student to a tenant membership. Rejects replayed jti values.
 */
export class PartnerSsoService {
  constructor(
    private readonly tenants: TenantRepository,
    private readonly users: UserRepository,
    private readonly memberships: MembershipRepository,
    private readonly replay: ReplayGuard,
    private readonly opts: PartnerSsoOptions,
  ) {}

  async verify(
    token: string,
    now = Date.now(),
  ): Promise<PartnerSsoResult> {
    // 1. Resolve partner from the (unverified) payload so we can pick the secret.
    const unverified = safeDecode(token);
    if (!unverified || typeof unverified.partnerId !== 'string') {
      return { ok: false, reason: 'unknown_partner' };
    }
    const secret = this.opts.secrets[unverified.partnerId];
    if (!secret) return { ok: false, reason: 'unknown_partner' };

    // 2. Verify signature + exp with the pinned algorithm.
    let claims: PartnerSsoClaims;
    try {
      const decoded = jwt.verify(token, secret, {
        algorithms: ['HS256'],
        maxAge: `${this.opts.maxAgeSeconds ?? 60}s`,
        clockTimestamp: Math.floor(now / 1000),
      });
      const parsed = PartnerSsoClaims.safeParse(decoded);
      if (!parsed.success) return { ok: false, reason: 'invalid_signature' };
      claims = parsed.data;
    } catch (err) {
      if (err instanceof jwt.TokenExpiredError) {
        return { ok: false, reason: 'token_expired' };
      }
      return { ok: false, reason: 'invalid_signature' };
    }

    // 3. Replay protection — a captured link must not be reusable.
    const fresh = await this.replay.claim(claims.jti, claims.partnerId);
    if (!fresh) return { ok: false, reason: 'replay_detected' };

    // 4. Resolve tenant by partner id (we treat partnerId as the tenant domain/id).
    const tenant =
      (await this.tenants.findByDomain(claims.partnerId)) ??
      (await this.tenants.findById(claims.partnerId));
    if (!tenant) return { ok: false, reason: 'unknown_partner' };

    // 5. Resolve or provision the user.
    let user = await this.users.findByEmail(claims.sub);
    if (!user) {
      if (!this.opts.jitProvisioning) {
        return { ok: false, reason: 'user_not_found' };
      }
      user = await this.users.upsertByEmail(
        claims.sub,
        claims.name ?? claims.sub,
      );
    }

    // 6. Resolve membership, creating a student membership on JIT provisioning.
    let membership = await this.memberships.find(user.id, tenant.id);
    if (!membership) {
      if (!this.opts.jitProvisioning) {
        return { ok: false, reason: 'user_not_found' };
      }
      membership = await this.memberships.create(user.id, tenant.id, 'student');
    }

    return {
      ok: true,
      user,
      tenantId: tenant.id,
      role: membership.role,
    };
  }
}

function safeDecode(token: string): Record<string, unknown> | null {
  try {
    const decoded = jwt.decode(token);
    return decoded && typeof decoded === 'object'
      ? (decoded as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
