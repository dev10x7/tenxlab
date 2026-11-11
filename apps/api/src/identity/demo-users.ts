/**
 * Demo identities for local development and UI walkthroughs. In production
 * users arrive via partner SSO or a password store; here they are a fixed list
 * so the seeded demo course can be exercised end to end.
 */
export interface DemoUser {
  id: string;
  email: string;
  fullName: string;
  password: string;
  tenantId: string;
  role: 'student' | 'instructor' | 'admin';
}

export const DEMO_USERS: DemoUser[] = [
  {
    id: 'demo-student',
    email: 'student@tenxlab.local',
    fullName: 'Demo Student',
    password: 'demo1234',
    tenantId: 'demo-tenant',
    role: 'student',
  },
  {
    id: 'demo-instructor',
    email: 'instructor@tenxlab.local',
    fullName: 'Demo Instructor',
    password: 'demo1234',
    tenantId: 'demo-tenant',
    role: 'instructor',
  },
];

export function findDemoUserByEmail(email: string): DemoUser | null {
  const normalized = email.trim().toLowerCase();
  return DEMO_USERS.find((u) => u.email.toLowerCase() === normalized) ?? null;
}

export function findDemoUserById(id: string): DemoUser | null {
  return DEMO_USERS.find((u) => u.id === id) ?? null;
}
