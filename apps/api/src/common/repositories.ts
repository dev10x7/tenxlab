import type {
  EventLedger,
  LabSessionRepository,
  LessonRepository,
  MembershipRepository,
  ProgressRepository,
  ReplayGuard,
  TenantRepository,
  UserRepository,
} from '../common/ports';

/**
 * The set of repositories the API wires its services from. Two implementations
 * exist: an in-memory one seeded with demo data (tests, catalog-only deploys)
 * and a Prisma/Postgres one (the system of record). Services depend only on the
 * port interfaces, so the two are interchangeable.
 */
export interface Repositories {
  tenants: TenantRepository;
  users: UserRepository;
  memberships: MembershipRepository;
  lessons: LessonRepository;
  sessions: LabSessionRepository;
  progress: ProgressRepository;
  ledger: EventLedger;
  replay: ReplayGuard;
}
