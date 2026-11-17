import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { SessionService, type SessionPayload } from '../identity/session.service';
import { can, type Capability } from '../identity/capabilities';

/**
 * Shared request guards. Controllers keep their own `requireSession` shim (it
 * only needs the injected service), but capability checks live here so the
 * role → capability map is consulted in exactly one place.
 */
export function sessionOf(sessions: SessionService, req: Request): SessionPayload {
  const session = sessions.fromCookieHeader(req.headers.cookie);
  if (!session) throw new UnauthorizedException('Sign in required');
  return session;
}

/** Require a session that holds `capability`, else 403. */
export function requireCapability(
  sessions: SessionService,
  req: Request,
  capability: Capability,
): SessionPayload {
  const session = sessionOf(sessions, req);
  if (!can(session.role, capability)) {
    throw new ForbiddenException(`This action requires the "${capability}" permission`);
  }
  return session;
}
