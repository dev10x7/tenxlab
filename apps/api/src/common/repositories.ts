import type {
  AttemptRepository,
  BatchRepository,
  EnrollmentRepository,
  EventLedger,
  LabSessionRepository,
  LessonRepository,
  MembershipRepository,
  ProctorEventRepository,
  ProgressRepository,
  ReplayGuard,
  SnippetRepository,
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
  batches: BatchRepository;
  enrollments: EnrollmentRepository;
  snippets: SnippetRepository;
  attempts: AttemptRepository;
  proctorEvents: ProctorEventRepository;
  ledger: EventLedger;
  replay: ReplayGuard;
}
