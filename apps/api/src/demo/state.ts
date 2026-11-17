import type { PrismaClient } from '@prisma/client';
import {
  InMemoryAttendanceRepository,
  InMemoryAttemptRepository,
  InMemoryBatchRepository,
  InMemoryClassSessionRepository,
  InMemoryCourseRepository,
  InMemoryEnrollmentRepository,
  InMemoryEventLedger,
  InMemoryGitConnectionRepository,
  InMemoryGitPublishRepository,
  InMemoryLabSessionRepository,
  InMemoryLessonRepository,
  InMemoryMembershipRepository,
  InMemoryModuleRepository,
  InMemoryProctorEventRepository,
  InMemoryProgressRepository,
  InMemoryProjectComponentRepository,
  InMemoryProjectForkRepository,
  InMemoryProjectRepository,
  InMemoryProjectSubmissionRepository,
  InMemoryProjectWorkspaceRepository,
  InMemoryQualityEvaluationRepository,
  InMemoryReplayGuard,
  InMemorySnippetRepository,
  InMemorySupportIssueRepository,
  InMemoryTenantRepository,
  InMemoryUserRepository,
  InMemorySkillPassportRepository,
  InMemoryInterviewAttemptRepository,
  InMemoryMentorMessageRepository,
  InMemoryBankQuestionRepository,
  InMemorySocialPostRepository,
  InMemorySocialFollowRepository,
  InMemoryDepartmentRepository,
} from '../common/in-memory';
import {
  PrismaAttendanceRepository,
  PrismaAttemptRepository,
  PrismaBatchRepository,
  PrismaClassSessionRepository,
  PrismaCourseRepository,
  PrismaEnrollmentRepository,
  PrismaEventLedger,
  PrismaGitConnectionRepository,
  PrismaGitPublishRepository,
  PrismaLabSessionRepository,
  PrismaLessonRepository,
  PrismaMembershipRepository,
  PrismaModuleRepository,
  PrismaProctorEventRepository,
  PrismaProgressRepository,
  PrismaProjectComponentRepository,
  PrismaProjectForkRepository,
  PrismaProjectRepository,
  PrismaProjectSubmissionRepository,
  PrismaProjectWorkspaceRepository,
  PrismaQualityEvaluationRepository,
  PrismaReplayGuard,
  PrismaSnippetRepository,
  PrismaSupportIssueRepository,
  PrismaTenantRepository,
  PrismaUserRepository,
  PrismaSkillPassportRepository,
  PrismaInterviewAttemptRepository,
  PrismaMentorMessageRepository,
  PrismaBankQuestionRepository,
  PrismaSocialPostRepository,
  PrismaSocialFollowRepository,
  PrismaDepartmentRepository,
} from '../common/prisma-repositories';
import type { Repositories } from '../common/repositories';
import { courseIdForSlug, DEMO_BATCH, DEMO_COURSES } from '../catalog/demo-data';
import { DEMO_USERS } from '../identity/demo-users';
import { DEMO_PROJECT, DEMO_PROJECT_COMPONENT } from '../projects/demo-project';

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
  courses: InMemoryCourseRepository;
  modules: InMemoryModuleRepository;
  lessons: InMemoryLessonRepository;
  sessions: InMemoryLabSessionRepository;
  progress: InMemoryProgressRepository;
  batches: InMemoryBatchRepository;
  enrollments: InMemoryEnrollmentRepository;
  snippets: InMemorySnippetRepository;
  attempts: InMemoryAttemptRepository;
  proctorEvents: InMemoryProctorEventRepository;
  projects: InMemoryProjectRepository;
  projectComponents: InMemoryProjectComponentRepository;
  projectWorkspaces: InMemoryProjectWorkspaceRepository;
  projectForks: InMemoryProjectForkRepository;
  projectSubmissions: InMemoryProjectSubmissionRepository;
  qualityEvaluations: InMemoryQualityEvaluationRepository;
  gitConnections: InMemoryGitConnectionRepository;
  gitPublishes: InMemoryGitPublishRepository;
  supportIssues: InMemorySupportIssueRepository;
  passports: InMemorySkillPassportRepository;
  interviews: InMemoryInterviewAttemptRepository;
  mentorMessages: InMemoryMentorMessageRepository;
  bankQuestions: InMemoryBankQuestionRepository;
  socialPosts: InMemorySocialPostRepository;
  socialFollows: InMemorySocialFollowRepository;
  departments: InMemoryDepartmentRepository;
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
      monthlyBudgetCents: 0,
      maxStorageGb: 0,
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
      course.lessons.map((lesson, index) => ({
        id: lesson.id,
        moduleId: lesson.moduleId,
        title: lesson.title,
        type: lesson.type,
        position: index,
        exerciseSlug: lesson.exerciseSlug ?? null,
        runtimeTier: lesson.runtimeTier ?? null,
        maxScore: lesson.maxScore,
        hint: lesson.hint ?? null,
        body: lesson.body ?? null,
        assessmentId: lesson.assessmentId ?? null,
      })),
    ),
  );

  // The demo corpus is keyed by slug; the system of record stores courses with a
  // derived stable id and the same slug, so the catalog and enrolment agree.
  const courses = new InMemoryCourseRepository(
    DEMO_COURSES.map((course) => ({
      id: courseIdForSlug(course.slug),
      tenantId: 'demo-tenant',
      slug: course.slug,
      title: course.title,
      description: course.description,
      status: 'published',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    })),
  );

  const modules = new InMemoryModuleRepository(
    DEMO_COURSES.flatMap((course) =>
      course.modules.map((m, index) => ({
        id: m.id,
        courseId: courseIdForSlug(course.slug),
        title: m.title,
        position: index,
      })),
    ),
  );

  const batches = new InMemoryBatchRepository([
    {
      id: DEMO_BATCH.id,
      tenantId: DEMO_BATCH.tenantId,
      name: DEMO_BATCH.name,
      departmentId: null,
      startDate: null,
      endDate: null,
    },
  ]);

  // The demo student is already in the demo batch, so the instructor gradebook
  // has a roster the moment the stack boots.
  const enrollments = new InMemoryEnrollmentRepository([
    {
      id: 'enrollment-demo-student',
      userId: 'demo-student',
      courseId: courseIdForSlug(DEMO_COURSES[0]?.slug ?? 'kubernetes-foundations'),
      batchId: DEMO_BATCH.id,
    },
  ]);

  return {
    tenants,
    users,
    memberships,
    courses,
    modules,
    lessons,
    sessions: new InMemoryLabSessionRepository(),
    progress: new InMemoryProgressRepository(),
    batches,
    enrollments,
    classSessions: new InMemoryClassSessionRepository(),
    attendance: new InMemoryAttendanceRepository(),
    snippets: new InMemorySnippetRepository(),
    attempts: new InMemoryAttemptRepository(),
    proctorEvents: new InMemoryProctorEventRepository(),
    projects: new InMemoryProjectRepository([DEMO_PROJECT]),
    projectComponents: new InMemoryProjectComponentRepository([DEMO_PROJECT_COMPONENT]),
    projectWorkspaces: new InMemoryProjectWorkspaceRepository(),
    projectForks: new InMemoryProjectForkRepository(),
    projectSubmissions: new InMemoryProjectSubmissionRepository(),
    qualityEvaluations: new InMemoryQualityEvaluationRepository(),
    gitConnections: new InMemoryGitConnectionRepository(),
    gitPublishes: new InMemoryGitPublishRepository(),
    supportIssues: new InMemorySupportIssueRepository(),
    passports: new InMemorySkillPassportRepository(),
    interviews: new InMemoryInterviewAttemptRepository(),
    mentorMessages: new InMemoryMentorMessageRepository(),
    bankQuestions: new InMemoryBankQuestionRepository(),
    socialPosts: new InMemorySocialPostRepository(),
    socialFollows: new InMemorySocialFollowRepository(),
    departments: new InMemoryDepartmentRepository(),
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
    courses: new PrismaCourseRepository(db),
    modules: new PrismaModuleRepository(db),
    lessons: new PrismaLessonRepository(db),
    sessions: new PrismaLabSessionRepository(db),
    progress: new PrismaProgressRepository(db),
    batches: new PrismaBatchRepository(db),
    enrollments: new PrismaEnrollmentRepository(db),
    classSessions: new PrismaClassSessionRepository(db),
    attendance: new PrismaAttendanceRepository(db),
    snippets: new PrismaSnippetRepository(db),
    attempts: new PrismaAttemptRepository(db),
    proctorEvents: new PrismaProctorEventRepository(db),
    projects: new PrismaProjectRepository(db),
    projectComponents: new PrismaProjectComponentRepository(db),
    projectWorkspaces: new PrismaProjectWorkspaceRepository(db),
    projectForks: new PrismaProjectForkRepository(db),
    projectSubmissions: new PrismaProjectSubmissionRepository(db),
    qualityEvaluations: new PrismaQualityEvaluationRepository(db),
    gitConnections: new PrismaGitConnectionRepository(db),
    gitPublishes: new PrismaGitPublishRepository(db),
    supportIssues: new PrismaSupportIssueRepository(db),
    passports: new PrismaSkillPassportRepository(db),
    interviews: new PrismaInterviewAttemptRepository(db),
    mentorMessages: new PrismaMentorMessageRepository(db),
    bankQuestions: new PrismaBankQuestionRepository(db),
    socialPosts: new PrismaSocialPostRepository(db),
    socialFollows: new PrismaSocialFollowRepository(db),
    departments: new PrismaDepartmentRepository(db),
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
