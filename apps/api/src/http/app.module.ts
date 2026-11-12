import { Module } from '@nestjs/common';
import { generateKeyPairSync } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { KubeLabAdapter, PistonProvider } from '@tenxlab/lab-provider';
import { loadEnv, type Env } from '../config/env';
import { JwtService } from '../crypto/jwt.service';
import { PartnerSsoService } from '../identity/partner-sso.service';
import { SessionService } from '../identity/session.service';
import { CatalogService } from '../catalog/catalog.service';
import { BatchService } from '../batches/batch.service';
import { EditorService } from '../editor/editor.service';
import { buildExerciseDescriptor, DEMO_COURSES } from '../catalog/demo-data';
import { findDemoUserById } from '../identity/demo-users';
import { LabLaunchService } from '../labs/lab-launch.service';
import { GradebookWebhookService } from '../gradebook/gradebook-webhook.service';
import { createDemoState, createPrismaState, resolveLessonId } from '../demo/state';
import type { Repositories } from '../common/repositories';
import {
  AuthController,
  BatchesController,
  CatalogController,
  EditorController,
  JwksController,
  LabAssetController,
  LabController,
  PartnerSsoController,
  WebhookController,
} from './controllers';
import { BATCH, CATALOG, EDITOR, ENV, GRADEBOOK, JWT, LAUNCH, PROVIDER, RUNNER, SESSION, SSO, STORE } from './tokens';

export { ENV, GRADEBOOK, JWT, LAUNCH, SSO, SESSION, CATALOG, PROVIDER, STORE, BATCH };

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
      useFactory: (env: Env) =>
        new KubeLabAdapter({
          baseUrl: env.KUBELAB_BASE_URL,
          adminEmail: env.KUBELAB_ADMIN_EMAIL,
          adminPassword: env.KUBELAB_ADMIN_PASSWORD,
          allowedHosts: env.KUBELAB_ALLOWED_HOSTS,
          ideScheme: env.KUBELAB_IDE_SCHEME,
          publicIdeBaseUrl: env.KUBELAB_IDE_PUBLIC_URL,
          resolveExercise: (slug) => buildExerciseDescriptor(slug, env.LAB_ASSET_BASE_URL),
          resolveUser: (userId) => resolveKubeLabUser(userId),
        }),
    },
    {
      provide: LAUNCH,
      inject: [ENV, STORE, PROVIDER],
      useFactory: (env: Env, store: Repositories, provider: KubeLabAdapter | null) =>
        new LabLaunchService({
          lessons: store.lessons,
          memberships: store.memberships,
          tenants: store.tenants,
          sessions: store.sessions,
          provider: env.KUBELAB_ENABLED ? provider : null,
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
      inject: [STORE, RUNNER],
      useFactory: (store: Repositories, runner: PistonProvider | null) =>
        new EditorService({ snippets: store.snippets, runner }),
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

function devKeys(kid: string) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { privateKey, publicKey, kid };
}
