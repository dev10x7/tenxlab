import type { PrismaClient } from '@prisma/client';
import {
  InMemoryEventLedger,
  InMemoryLabSessionRepository,
  InMemoryLessonRepository,
  InMemoryMembershipRepository,
  InMemoryProgressRepository,
  InMemoryReplayGuard,
  InMemoryTenantRepository,
  InMemoryUserRepository,
} from '../common/in-memory';
import {
  PrismaEventLedger,
  PrismaLabSessionRepository,
  PrismaLessonRepository,
  PrismaMembershipRepository,
  PrismaProgressRepository,
  PrismaReplayGuard,
  PrismaTenantRepository,
  PrismaUserRepository,
} from '../common/prisma-repositories';
import type { Repositories } from '../common/repositories';
import { DEMO_COURSES } from '../catalog/demo-data';
import { DEMO_USERS } from '../identity/demo-users';

/**
 * In-memory repository set, seeded from the demo catalog. Used by unit tests and
 * catalog-only deployments. These are shared singletons so the catalog, lab
 * launch, and gradebook all see the same rows — a lesson launched by the student
 * is the lesson the gradebook later marks complete.
 */
export interface DemoState extends Repositories {
  tenants: InMemoryTenantRepository;
  users: InMemoryUserRepository;
  memberships: InMemoryMembershipRepository;
  lessons: InMemoryLessonRepository;
  sessions: InMemoryLabSessionRepository;
  progress: InMemoryProgressRepository;
  ledger: InMemoryEventLedger;
  replay: InMemoryReplayGuard;
}

export function createDemoState(): DemoState {
  const tenants = new InMemoryTenantRepository([
    {
      id: 'demo-tenant',
      name: 'Demo College',
      domain: 'demo-college',
      maxConcurrentLabs: 50,
      plan: 'standard',
      status: 'active',
    },
  ]);

  const users = new InMemoryUserRepository(
    DEMO_USERS.map((u) => ({ id: u.id, email: u.email, fullName: u.fullName })),
  );

  const memberships = new InMemoryMembershipRepository(
    DEMO_USERS.map((u) => ({
      id: `membership-${u.id}`,
      userId: u.id,
      tenantId: u.tenantId,
      role: u.role,
      status: 'active',
    })),
  );

  const lessons = new InMemoryLessonRepository(
    DEMO_COURSES.flatMap((course) =>
      course.lessons.map((lesson) => ({
        id: lesson.id,
        moduleId: lesson.moduleId,
        title: lesson.title,
        type: lesson.type,
        exerciseSlug: lesson.exerciseSlug ?? null,
        runtimeTier: lesson.runtimeTier ?? null,
        maxScore: lesson.maxScore,
      })),
    ),
  );

  return {
    tenants,
    users,
    memberships,
    lessons,
    sessions: new InMemoryLabSessionRepository(),
    progress: new InMemoryProgressRepository(),
    ledger: new InMemoryEventLedger(),
    replay: new InMemoryReplayGuard(),
  };
}

/** Prisma/Postgres-backed repository set — the production system of record. */
export function createPrismaState(db: PrismaClient): Repositories {
  return {
    tenants: new PrismaTenantRepository(db),
    users: new PrismaUserRepository(db),
    memberships: new PrismaMembershipRepository(db),
    lessons: new PrismaLessonRepository(db),
    sessions: new PrismaLabSessionRepository(db),
    progress: new PrismaProgressRepository(db),
    ledger: new PrismaEventLedger(db),
    replay: new PrismaReplayGuard(db),
  };
}

/**
 * Map an LMS exercise slug to a lesson id within a tenant. In-memory builds use
 * the demo corpus; the Prisma build resolves through the lesson repository.
 */
export function resolveLessonId(slug: string, tenantId: string): string | null {
  if (tenantId !== 'demo-tenant') return null;
  for (const course of DEMO_COURSES) {
    for (const lesson of course.lessons) {
      if (lesson.exerciseSlug === slug) return lesson.id;
    }
  }
  return null;
}
