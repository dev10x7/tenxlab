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
  type WorkspaceReader,
} from '@tenxlab/lab-provider';
import { loadEnv, type Env } from '../config/env';
import { JwtService } from '../crypto/jwt.service';
import { PartnerSsoService } from '../identity/partner-sso.service';
import { SessionService } from '../identity/session.service';
import { CatalogService } from '../catalog/catalog.service';
import { BatchService } from '../batches/batch.service';
import { EditorService } from '../editor/editor.service';
import { AssessmentService } from '../assessments/assessment.service';
import { ProctoringService } from '../proctoring/proctoring.service';
import { buildExerciseDescriptor, DEMO_COURSES } from '../catalog/demo-data';
import { findDemoUserById } from '../identity/demo-users';
import { LabLaunchService } from '../labs/lab-launch.service';
import { UsageService } from '../labs/usage.service';
import { ProjectService } from '../projects/project.service';
import { ProjectSubmissionService } from '../projects/project-submission.service';
import { QualityEvaluationService } from '../projects/quality-evaluation.service';
import { AiBridgeClient } from '../ai/ai-bridge.client';
import { GitHubClient } from '../github/github.client';
import { GitPublishService } from '../github/git-publish.service';
import { SecretBox } from '../crypto/secret-box';
import { GradebookWebhookService } from '../gradebook/gradebook-webhook.service';
import { createDemoState, createPrismaState, resolveLessonId } from '../demo/state';
import type { Repositories } from '../common/repositories';
import {
  AssessmentController,
  AuthController,
  BatchesController,
  CatalogController,
  EditorController,
  GitController,
  JwksController,
  LabAssetController,
  LabController,
  PartnerSsoController,
  ProctoringController,
  ProjectsController,
  WebhookController,
} from './controllers';
import { ASSESSMENT, BATCH, CATALOG, EDITOR, ENV, GIT, GITHUB, GRADEBOOK, JWT, LAUNCH, PROCTOR, PROJECT, PROJECT_SUBMISSION, PROVIDER, QUALITY, RUNNER, SECRET_BOX, SESSION, SSO, STORE, USAGE, AI_BRIDGE } from './tokens';

export { ENV, GRADEBOOK, JWT, LAUNCH, SSO, SESSION, CATALOG, PROVIDER, STORE, BATCH, GIT, GITHUB, SECRET_BOX, USAGE, QUALITY };

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
    PartnerSsoController,
    LabController,
    LabAssetController,
    WebhookController,
    BatchesController,
    EditorController,
    AssessmentController,
    ProctoringController,
    ProjectsController,
    GitController,
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
        new CatalogService(store.progress, DEMO_COURSES),
    },
    {
      provide: BATCH,
      inject: [STORE],
      useFactory: (store: Repositories) =>
        new BatchService(
          store.batches,
          store.enrollments,
          store.memberships,
          store.users,
          store.progress,
          // The gradebook columns are the lessons of the demo course the
          // batches are built around.
          DEMO_COURSES[0]?.lessons.map((l) => ({ id: l.id, title: l.title })) ?? [],
        ),
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
        const routes: Record<string, LabProvider> = {};

        // Tier-3: KubeLab's vcluster path, unmodified (ADR-8).
        if (env.KUBELAB_ENABLED) {
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

        // Tier-2: our own pod provider (code-server + terminal, no vcluster).
        if (env.POD_PROVIDER_ENABLED) {
          routes['tier_2_container'] = new PodProvider({
            cluster: new KubernetesClient(),
            allowedHosts: env.KUBELAB_ALLOWED_HOSTS,
            ideScheme: env.KUBELAB_IDE_SCHEME,
            publicIdeBaseUrl: env.KUBELAB_IDE_PUBLIC_URL,
            codeServerImage: env.CODE_SERVER_IMAGE,
          });
        }

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
      inject: [ENV, STORE, PROVIDER],
      useFactory: (env: Env, store: Repositories, provider: LabProvider | null) =>
        new ProjectService({
          projects: store.projects,
          components: store.projectComponents,
          workspaces: store.projectWorkspaces,
          forks: store.projectForks,
          memberships: store.memberships,
          provider: env.PROJECTS_ENABLED ? provider : null,
          // Deploy (E5) reuses the same provider when it can expose a service.
          exposer: env.PROJECTS_ENABLED ? (provider as ServiceExposer | null) : null,
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
      inject: [STORE, PROVIDER, AI_BRIDGE],
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
      inject: [STORE, PROVIDER, GITHUB, SECRET_BOX],
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
