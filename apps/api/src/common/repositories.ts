import type {
  AttendanceRepository,
  AttemptRepository,
  BatchRepository,
  ClassSessionRepository,
  ContestEntryRepository,
  ContestRepository,
  CourseRepository,
  EnrollmentRepository,
  EventLedger,
  BankQuestionRepository,
  DepartmentRepository,
  GitConnectionRepository,
  GitPublishRepository,
  InterviewAttemptRepository,
  LabSessionRepository,
  LessonRepository,
  MembershipRepository,
  MentorMessageRepository,
  ModuleRepository,
  ProctorEventRepository,
  ProgressRepository,
  ProjectComponentRepository,
  ProjectForkRepository,
  ProjectRepository,
  ProjectSubmissionRepository,
  ProjectWorkspaceRepository,
  QualityEvaluationRepository,
  ReplayGuard,
  SkillPassportRepository,
  SnippetRepository,
  SocialFollowRepository,
  SocialPostRepository,
  SupportIssueRepository,
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
  courses: CourseRepository;
  modules: ModuleRepository;
  lessons: LessonRepository;
  sessions: LabSessionRepository;
  progress: ProgressRepository;
  batches: BatchRepository;
  enrollments: EnrollmentRepository;
  classSessions: ClassSessionRepository;
  attendance: AttendanceRepository;
  snippets: SnippetRepository;
  attempts: AttemptRepository;
  proctorEvents: ProctorEventRepository;
  projects: ProjectRepository;
  projectComponents: ProjectComponentRepository;
  projectWorkspaces: ProjectWorkspaceRepository;
  projectForks: ProjectForkRepository;
  projectSubmissions: ProjectSubmissionRepository;
  qualityEvaluations: QualityEvaluationRepository;
  gitConnections: GitConnectionRepository;
  gitPublishes: GitPublishRepository;
  supportIssues: SupportIssueRepository;
  passports: SkillPassportRepository;
  interviews: InterviewAttemptRepository;
  mentorMessages: MentorMessageRepository;
  bankQuestions: BankQuestionRepository;
  socialPosts: SocialPostRepository;
  socialFollows: SocialFollowRepository;
  departments: DepartmentRepository;
  contests: ContestRepository;
  contestEntries: ContestEntryRepository;
  ledger: EventLedger;
  replay: ReplayGuard;
}
