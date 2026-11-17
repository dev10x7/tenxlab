import { Module } from '@nestjs/common';
import { generateKeyPairSync } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import {
  KubeLabAdapter,
  KubernetesClient,
  PistonProvider,
  PodProvider,
  RoutingProvider,
  type GitPublisher,
  type LabProvider,
  type ServiceExposer,
  type WorkspaceArchiver,
  type WorkspaceReader,
} from '@tenxlab/lab-provider';
import { loadEnv, type Env } from '../config/env';
import { JwtService } from '../crypto/jwt.service';
import { PartnerSsoService } from '../identity/partner-sso.service';
import { SessionService } from '../identity/session.service';
import { CatalogService } from '../catalog/catalog.service';
import { CourseAuthoringService } from '../catalog/course-authoring.service';
import { courseCatalogFrom } from '../catalog/course-catalog';
import { BatchService } from '../batches/batch.service';
import { AttendanceService } from '../attendance/attendance.service';
import { SupportService } from '../support/support.service';
import { DashboardService } from '../dashboard/dashboard.service';
import { EditorService } from '../editor/editor.service';
import { AssessmentService } from '../assessments/assessment.service';
import { ProctoringService } from '../proctoring/proctoring.service';
import { buildExerciseDescriptor } from '../catalog/demo-data';
import type { CourseCatalog } from '../catalog/course-catalog';
import { findDemoUserById } from '../identity/demo-users';
import { LabLaunchService } from '../labs/lab-launch.service';
import { UsageService } from '../labs/usage.service';
import { ProjectService } from '../projects/project.service';
import { ProjectCopyService } from '../projects/copy.service';
import { ProjectSubmissionService } from '../projects/project-submission.service';
import { QualityEvaluationService } from '../projects/quality-evaluation.service';
import { PassportService } from '../hiring/passport.service';
import { InterviewerService } from '../hiring/interviewer.service';
import { ReportsService } from '../insights/reports.service';
import { MentorService } from '../mentor/mentor.service';
import { FeedService } from '../social/feed.service';
import { SocialService } from '../social/social.service';
import { QuestionBankService } from '../questions/question-bank.service';
import { OrgService } from '../organizations/org.service';
import { AiBridgeClient } from '../ai/ai-bridge.client';
import { GitHubClient } from '../github/github.client';
import { GitPublishService } from '../github/git-publish.service';
import { SecretBox } from '../crypto/secret-box';
import { GradebookWebhookService } from '../gradebook/gradebook-webhook.service';
import { createDemoState, createPrismaState, resolveLessonId } from '../demo/state';
import type { Repositories } from '../common/repositories';
import {
  AssessmentController,
  AttendanceController,
  AuthController,
  BatchesController,
  CatalogController,
  CourseAuthoringController,
  DashboardController,
  EditorController,
  GitController,
  JwksController,
  LabAssetController,
  LabController,
  PartnerSsoController,
  ProctoringController,
  ProjectsController,
  SupportController,
  WebhookController,
  PassportController,
  InterviewerController,
  MentorController,
  FeedController,
  SocialController,
  ReportsController,
  QuestionBankController,
  OrganizationsController,
} from './controllers';
import { ASSESSMENT, ATTENDANCE, BATCH, CATALOG, COURSE_AUTHORING, COURSE_CATALOG, DASHBOARD, EDITOR, ENV, FORK_PROVIDER, GIT, GITHUB, GRADEBOOK, JWT, LAUNCH, PROCTOR, PROJECT, PROJECT_COPY, PROJECT_SUBMISSION, PROVIDER, QUALITY, RUNNER, SECRET_BOX, SESSION, SSO, STORE, SUPPORT, USAGE, AI_BRIDGE, PASSPORT, REPORTS, MENTOR, INTERVIEWER, FEED, SOCIAL, QUESTION_BANK, ORGS } from './tokens';

export { ENV, GRADEBOOK, JWT, LAUNCH, SSO, SESSION, CATALOG, PROVIDER, FORK_PROVIDER, STORE, BATCH, ATTENDANCE, GIT, GITHUB, SECRET_BOX, USAGE, QUALITY, PROJECT_COPY, DASHBOARD, SUPPORT, PASSPORT, REPORTS, MENTOR, INTERVIEWER, FEED, SOCIAL, QUESTION_BANK, ORGS };

const DEMO_STATE = createDemoState();

/**
 * Repository wiring. `USE_DATABASE=true` selects the Prisma/Postgres system of
 * record; otherwise the in-memory demo store is used (tests, catalog-only
 * deploys). Both satisfy the same ports, so the services below are unchanged.
 */
const STORE_PROVIDER = {
  provide: STORE,
  inject: [ENV],
  useFactory: (env: Env): Repositories => {
    if (env.USE_DATABASE) {
      const db = new PrismaClient();
      return createPrismaState(db);
    }
    return DEMO_STATE;
  },
};

/**
 * LMS API wiring: repositories from the selected store, plus a real KubeLab
 * provider when `KUBELAB_ENABLED` is set.
 */
@Module({
  controllers: [
    JwksController,
    AuthController,
    CatalogController,
    CourseAuthoringController,
    PartnerSsoController,
    LabController,
    LabAssetController,
    WebhookController,
    BatchesController,
    AttendanceController,
    EditorController,
    AssessmentController,
    ProctoringController,
    ProjectsController,
    GitController,
    DashboardController,
    SupportController,
    PassportController,
    InterviewerController,
    MentorController,
    FeedController,
    SocialController,
    ReportsController,
    QuestionBankController,
    OrganizationsController,
  ],
  providers: [
    { provide: ENV, useFactory: () => loadEnv() },
    STORE_PROVIDER,
    {
      provide: JWT,
      inject: [ENV],
      useFactory: (env: Env) => {
        const keys =
          env.JWT_PRIVATE_KEY && env.JWT_PUBLIC_KEY
            ? { privateKey: env.JWT_PRIVATE_KEY, publicKey: env.JWT_PUBLIC_KEY, kid: env.JWT_KID }
            : devKeys(env.JWT_KID);
        return new JwtService(keys, env.LAUNCH_JWT_TTL_SECONDS);
      },
    },
    {
      provide: SESSION,
      inject: [ENV],
      useFactory: (env: Env) => new SessionService(env.SESSION_SECRET),
    },
    {
      provide: CATALOG,
      inject: [STORE],
      useFactory: (store: Repositories) =>
        new CatalogService(store.courses, store.modules, store.lessons, store.progress),
    },
    {
      provide: COURSE_AUTHORING,
      inject: [STORE],
      useFactory: (store: Repositories) =>
        new CourseAuthoringService(store.courses, store.modules, store.lessons),
    },
    {
      provide: COURSE_CATALOG,
      inject: [STORE],
      useFactory: (store: Repositories) =>
        courseCatalogFrom(store.courses, store.modules, store.lessons),
    },
    {
      provide: BATCH,
      inject: [STORE, COURSE_CATALOG],
      useFactory: (store: Repositories, catalog: CourseCatalog) =>
        new BatchService(
          store.batches,
          store.enrollments,
          store.memberships,
          store.users,
          store.progress,
          catalog,
        ),
    },
    {
      provide: DASHBOARD,
      inject: [STORE, COURSE_CATALOG],
      useFactory: (store: Repositories, catalog: CourseCatalog) =>
        new DashboardService({
          users: store.users,
          memberships: store.memberships,
          enrollments: store.enrollments,
          progress: store.progress,
          snippets: store.snippets,
          workspaces: store.projectWorkspaces,
          submissions: store.projectSubmissions,
          gitConnections: store.gitConnections,
          projects: store.projects,
          attempts: store.attempts,
          // Roadmaps resolve an enrolment's courseId to a title and its lessons.
          courses: catalog,
        }),
    },
    {
      provide: ATTENDANCE,
      inject: [STORE],
      useFactory: (store: Repositories) =>
        new AttendanceService({
          batches: store.batches,
          sessions: store.classSessions,
          attendance: store.attendance,
          enrollments: store.enrollments,
          users: store.users,
        }),
    },
    {
      provide: SUPPORT,
      inject: [STORE],
      useFactory: (store: Repositories) => new SupportService(store.supportIssues),
    },
    {
      provide: PASSPORT,
      inject: [STORE],
      useFactory: (store: Repositories) =>
        new PassportService({
          passports: store.passports,
          progress: store.progress,
          interviews: store.interviews,
          memberships: store.memberships,
          users: store.users,
        }),
    },
    {
      provide: INTERVIEWER,
      inject: [STORE, AI_BRIDGE, PASSPORT],
      useFactory: (
        store: Repositories,
        bridge: AiBridgeClient | null,
        passports: PassportService,
      ) =>
        new InterviewerService({
          interviews: store.interviews,
          evaluator: bridge,
          passports,
        }),
    },
    {
      provide: MENTOR,
      inject: [STORE, AI_BRIDGE],
      useFactory: (store: Repositories, bridge: AiBridgeClient | null) =>
        new MentorService({ messages: store.mentorMessages, assistant: bridge }),
    },
    {
      provide: FEED,
      inject: [STORE],
      useFactory: (store: Repositories) =>
        new FeedService({
          memberships: store.memberships,
          enrollments: store.enrollments,
          progress: store.progress,
          users: store.users,
          projects: store.projects,
          submissions: store.projectSubmissions,
          posts: store.socialPosts,
          lessons: store.lessons,
        }),
    },
    {
      provide: SOCIAL,
      inject: [STORE],
      useFactory: (store: Repositories) =>
        new SocialService({
          posts: store.socialPosts,
          follows: store.socialFollows,
          users: store.users,
          memberships: store.memberships,
        }),
    },
    {
      provide: REPORTS,
      inject: [STORE, COURSE_CATALOG],
      useFactory: (store: Repositories, catalog: CourseCatalog) =>
        new ReportsService({
          batches: store.batches,
          enrollments: store.enrollments,
          progress: store.progress,
          users: store.users,
          classSessions: store.classSessions,
          attendance: store.attendance,
          projects: store.projects,
          submissions: store.projectSubmissions,
          courses: catalog,
        }),
    },
    {
      provide: QUESTION_BANK,
      inject: [STORE],
      useFactory: (store: Repositories) => new QuestionBankService(store.bankQuestions),
    },
    {
      provide: ORGS,
      inject: [STORE],
      useFactory: (store: Repositories) =>
        new OrgService({
          tenants: store.tenants,
          departments: store.departments,
          batches: store.batches,
          memberships: store.memberships,
          users: store.users,
        }),
    },
    {
      provide: SSO,
      inject: [ENV, STORE],
      useFactory: (env: Env, store: Repositories) =>
        new PartnerSsoService(store.tenants, store.users, store.memberships, store.replay, {
          secrets: env.PARTNER_SSO_SECRETS,
          jitProvisioning: true,
        }),
    },
    {
      provide: PROVIDER,
      inject: [ENV],
      useFactory: (env: Env): LabProvider | null => {
        const routes = buildProviderRoutes(env, { persistent: false });
        if (Object.keys(routes).length === 0) return null;
        return new RoutingProvider(routes);
      },
    },
    {
      // Forks provision a *persistent* tier-2 workspace: a Deployment+PVC the
      // operator can scale to zero on idle (ADR-20), rather than a lab's bare
      // pod. Tier-3 KubeLab has no fork workspace model, so it is never routed
      // here; a fork always lands on tier-2.
      provide: FORK_PROVIDER,
      inject: [ENV],
      useFactory: (env: Env): LabProvider | null => {
        if (!env.PROJECTS_ENABLED || !env.POD_PROVIDER_ENABLED) return null;
        const routes = buildProviderRoutes(env, { persistent: true });
        if (Object.keys(routes).length === 0) return null;
        return new RoutingProvider(routes);
      },
    },
    {
      provide: USAGE,
      inject: [STORE],
      useFactory: (store: Repositories) =>
        new UsageService({ tenants: store.tenants, sessions: store.sessions }),
    },
    {
      provide: LAUNCH,
      inject: [ENV, STORE, PROVIDER, USAGE],
      useFactory: (
        env: Env,
        store: Repositories,
        provider: LabProvider | null,
        usage: UsageService,
      ) =>
        new LabLaunchService({
          lessons: store.lessons,
          memberships: store.memberships,
          tenants: store.tenants,
          sessions: store.sessions,
          provider: env.KUBELAB_ENABLED ? provider : null,
          usage,
        }),
    },
    {
      provide: GRADEBOOK,
      inject: [ENV, STORE],
      useFactory: (env: Env, store: Repositories) =>
        new GradebookWebhookService({
          webhookSecret: env.WEBHOOK_SECRET,
          ledger: store.ledger,
          sessions: store.sessions,
          progress: store.progress,
          resolveLessonId: async (slug, tenantId) =>
            resolveLessonForSlug(store, slug, tenantId),
        }),
    },
    {
      // Tier-1 execution pool. Null when disabled so the Editor still serves
      // languages and snippets; only Run returns 503.
      provide: RUNNER,
      inject: [ENV],
      useFactory: (env: Env) =>
        env.PISTON_ENABLED
          ? new PistonProvider({
              baseUrl: env.PISTON_BASE_URL,
              version: env.PISTON_VERSION,
              runTimeoutMs: env.PISTON_RUN_TIMEOUT_MS,
            })
          : null,
    },
    {
      provide: EDITOR,
      inject: [STORE, RUNNER, AI_BRIDGE],
      useFactory: (
        store: Repositories,
        runner: PistonProvider | null,
        bridge: AiBridgeClient | null,
      ) => new EditorService({ snippets: store.snippets, runner, reviewer: bridge }),
    },
    {
      provide: ASSESSMENT,
      inject: [STORE, RUNNER],
      useFactory: (store: Repositories, runner: PistonProvider | null) =>
        new AssessmentService({
          attempts: store.attempts,
          memberships: store.memberships,
          runner,
        }),
    },
    {
      provide: PROCTOR,
      inject: [STORE],
      useFactory: (store: Repositories) =>
        new ProctoringService(store.proctorEvents),
    },
    {
      provide: PROJECT,
      inject: [ENV, STORE, FORK_PROVIDER],
      useFactory: (env: Env, store: Repositories, provider: LabProvider | null) =>
        new ProjectService({
          projects: store.projects,
          components: store.projectComponents,
          workspaces: store.projectWorkspaces,
          forks: store.projectForks,
          memberships: store.memberships,
          tenants: store.tenants,
          provider,
          // Deploy (E5) reuses the same provider when it can expose a service.
          exposer: provider as ServiceExposer | null,
          // Download (Nov'25 §1.5) reuses it again when it can archive a volume.
          archiver: provider as WorkspaceArchiver | null,
          defaultTier: env.PROJECTS_TIER,
        }),
    },
    {
      provide: PROJECT_SUBMISSION,
      inject: [STORE],
      useFactory: (store: Repositories) =>
        new ProjectSubmissionService({
          projects: store.projects,
          components: store.projectComponents,
          workspaces: store.projectWorkspaces,
          forks: store.projectForks,
          submissions: store.projectSubmissions,
          memberships: store.memberships,
        }),
    },
    {
      // The AI plane client (FastAPI). A null client disables auto-evaluation;
      // the controller then answers analysis_unavailable.
      provide: AI_BRIDGE,
      inject: [ENV],
      useFactory: (env: Env) =>
        env.AI_PLANE_URL
          ? new AiBridgeClient({
              baseUrl: env.AI_PLANE_URL,
              timeoutMs: env.AI_PLANE_TIMEOUT_MS,
            })
          : null,
    },
    {
      provide: QUALITY,
      inject: [STORE, FORK_PROVIDER, AI_BRIDGE],
      useFactory: (
        store: Repositories,
        provider: LabProvider | null,
        analyzer: AiBridgeClient | null,
      ) =>
        new QualityEvaluationService({
          workspaces: store.projectWorkspaces,
          evaluations: store.qualityEvaluations,
          // Reading files is a tier-2 (pod) concern; a KubeLab-only deployment
          // has no reader, so analysis stays unavailable rather than failing.
          reader: isWorkspaceReader(provider) ? provider : null,
          analyzer,
        }),
    },
    {
      provide: PROJECT_COPY,
      inject: [AI_BRIDGE],
      useFactory: (suggester: AiBridgeClient | null) =>
        new ProjectCopyService(suggester),
    },
    {
      provide: SECRET_BOX,
      inject: [ENV],
      useFactory: (env: Env) => new SecretBox(env.TOKEN_ENCRYPTION_SECRET),
    },
    {
      provide: GITHUB,
      inject: [ENV],
      useFactory: (env: Env) =>
        new GitHubClient({
          clientId: env.GITHUB_CLIENT_ID,
          apiBase: env.GITHUB_API_BASE,
          oauthBase: env.GITHUB_OAUTH_BASE,
        }),
    },
    {
      provide: GIT,
      inject: [STORE, FORK_PROVIDER, GITHUB, SECRET_BOX],
      useFactory: (
        store: Repositories,
        provider: LabProvider | null,
        github: GitHubClient,
        secretBox: SecretBox,
      ) =>
        new GitPublishService({
          connections: store.gitConnections,
          publishes: store.gitPublishes,
          workspaces: store.projectWorkspaces,
          // Publish reuses the same provider when it can push a workspace; a
          // provider that cannot (e.g. a KubeLab-only deployment) leaves the
          // control hidden and the endpoint answers publish_unavailable.
          publisher: isGitPublisher(provider) ? provider : null,
          github,
          secretBox,
        }),
    },
  ],
})
export class AppModule {}

/**
 * Resolve an exercise slug to a lesson id. The Prisma store answers from the
 * lessons table; the in-memory store uses the demo corpus mapping.
 */
async function resolveLessonForSlug(
  store: Repositories,
  slug: string,
  tenantId: string,
): Promise<string | null> {
  if (store.lessons.findByExerciseSlug) {
    const lesson = await store.lessons.findByExerciseSlug(slug);
    return lesson?.id ?? null;
  }
  return resolveLessonId(slug, tenantId);
}

function resolveKubeLabUser(userId: string): {
  email: string;
  name: string;
  role?: string;
} {
  const user = findDemoUserById(userId);
  if (user) return { email: user.email, name: user.fullName, role: user.role };
  return { email: `${userId}@tenxlab.local`, name: userId };
}

/**
 * Build the tier→provider route table. `persistent` selects the tier-2 pod
 * mode: a lab is a disposable bare Pod, while a project fork is a Deployment
 * whose compute can be scaled to zero while its volume survives (ADR-20).
 *
 * Tier-3 is KubeLab's vcluster path, unmodified (ADR-8). It is a lab-only route:
 * KubeLab has no fork workspace model, so a persistent route set omits it and a
 * fork always lands on tier-2.
 */
function buildProviderRoutes(
  env: Env,
  options: { persistent: boolean },
): Record<string, LabProvider> {
  const routes: Record<string, LabProvider> = {};

  if (env.KUBELAB_ENABLED && !options.persistent) {
    routes['tier_3_vcluster'] = new KubeLabAdapter({
      baseUrl: env.KUBELAB_BASE_URL,
      adminEmail: env.KUBELAB_ADMIN_EMAIL,
      adminPassword: env.KUBELAB_ADMIN_PASSWORD,
      allowedHosts: env.KUBELAB_ALLOWED_HOSTS,
      ideScheme: env.KUBELAB_IDE_SCHEME,
      publicIdeBaseUrl: env.KUBELAB_IDE_PUBLIC_URL,
      resolveExercise: (slug) => buildExerciseDescriptor(slug, env.LAB_ASSET_BASE_URL),
      resolveUser: (userId) => resolveKubeLabUser(userId),
    });
  }

  if (env.POD_PROVIDER_ENABLED) {
    routes['tier_2_container'] = new PodProvider({
      cluster: new KubernetesClient(),
      allowedHosts: env.KUBELAB_ALLOWED_HOSTS,
      ideScheme: env.KUBELAB_IDE_SCHEME,
      publicIdeBaseUrl: env.KUBELAB_IDE_PUBLIC_URL,
      codeServerImage: env.CODE_SERVER_IMAGE,
      persistent: options.persistent,
    });
  }

  return routes;
}

/** Structural check: can this provider push a workspace to a git remote? */
function isGitPublisher(
  provider: LabProvider | null,
): provider is LabProvider & GitPublisher {
  return typeof (provider as Partial<GitPublisher> | null)?.publish === 'function';
}

/** Structural check: can this provider read a workspace's files? */
function isWorkspaceReader(
  provider: LabProvider | null,
): provider is LabProvider & WorkspaceReader {
  return typeof (provider as Partial<WorkspaceReader> | null)?.readWorkspaceFiles === 'function';
}

function devKeys(kid: string) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { privateKey, publicKey, kid };
}
