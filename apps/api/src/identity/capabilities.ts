/**
 * Fine-grained capabilities. The session carries a coarse role; authoring and
 * proctoring surfaces gate on a capability so a role's powers can grow without
 * adding a new role, mirroring ByteXL's `test:edit`-style permission tiers.
 *
 * Roles are intentionally few (student/instructor/admin). Capabilities are the
 * stable contract the controllers check; the role → capability map is the one
 * place to change what a role may do.
 */
export const CAPABILITIES = [
  'course:write',
  'assessment:write',
  'project:write',
  'proctoring:read',
  'clarity:read',
  'test:edit',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

const BY_ROLE: Record<string, Capability[]> = {
  student: [],
  instructor: [
    'course:write',
    'assessment:write',
    'project:write',
    'proctoring:read',
    'clarity:read',
    'test:edit',
  ],
  admin: [
    'course:write',
    'assessment:write',
    'project:write',
    'proctoring:read',
    'clarity:read',
    'test:edit',
  ],
};

/** The capabilities a role holds; unknown roles hold none. */
export function capabilitiesFor(role: string | undefined): Capability[] {
  return BY_ROLE[role ?? ''] ?? [];
}

/** Whether a role holds a capability. */
export function can(role: string | undefined, capability: Capability): boolean {
  return capabilitiesFor(role).includes(capability);
}
