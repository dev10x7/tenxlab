import { Module } from '@nestjs/common';
import { generateKeyPairSync } from 'node:crypto';
import { KubeLabAdapter } from '@tenxlab/lab-provider';
import { loadEnv, type Env } from '../config/env';
import { JwtService } from '../crypto/jwt.service';
import { PartnerSsoService } from '../identity/partner-sso.service';
import { SessionService } from '../identity/session.service';
import { CatalogService } from '../catalog/catalog.service';
import { buildExerciseDescriptor, DEMO_COURSES } from '../catalog/demo-data';
import { findDemoUserById } from '../identity/demo-users';
import { LabLaunchService } from '../labs/lab-launch.service';
import { GradebookWebhookService } from '../gradebook/gradebook-webhook.service';
import { createDemoState, resolveLessonId, type DemoState } from '../demo/state';
import {
  AuthController,
  CatalogController,
  JwksController,
  LabAssetController,
  LabController,
  PartnerSsoController,
  WebhookController,
} from './controllers';
import { CATALOG, ENV, GRADEBOOK, JWT, LAUNCH, PROVIDER, SESSION, SSO } from './tokens';

export { ENV, GRADEBOOK, JWT, LAUNCH, SSO, SESSION, CATALOG, PROVIDER };

const DEMO_STATE = createDemoState();

/**
 * Local development wiring: in-memory repositories seeded with the demo course,
 * plus a real KubeLab provider when `KUBELAB_ENABLED` is set.
 *
 * Production replaces the repositories with Prisma-backed adapters (see
 * prisma/schema.prisma) and always runs with the provider enabled.
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
  ],
  providers: [
    { provide: ENV, useFactory: () => loadEnv() },
    { provide: 'DEMO_STATE', useValue: DEMO_STATE },
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
      inject: ['DEMO_STATE'],
      useFactory: (state: DemoState) =>
        new CatalogService(state.progress, DEMO_COURSES),
    },
    {
      provide: SSO,
      inject: [ENV, 'DEMO_STATE'],
      useFactory: (env: Env, state: DemoState) =>
        new PartnerSsoService(state.tenants, state.users, state.memberships, state.replay, {
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
          resolveExercise: (slug) => buildExerciseDescriptor(slug, env.LAB_ASSET_BASE_URL),
          resolveUser: (userId) => resolveKubeLabUser(userId),
        }),
    },
    {
      provide: LAUNCH,
      inject: [ENV, 'DEMO_STATE', PROVIDER],
      useFactory: (env: Env, state: DemoState, provider: KubeLabAdapter | null) =>
        new LabLaunchService({
          lessons: state.lessons,
          memberships: state.memberships,
          tenants: state.tenants,
          sessions: state.sessions,
          provider: env.KUBELAB_ENABLED ? provider : null,
        }),
    },
    {
      provide: GRADEBOOK,
      inject: [ENV, 'DEMO_STATE'],
      useFactory: (env: Env, state: DemoState) =>
        new GradebookWebhookService({
          webhookSecret: env.WEBHOOK_SECRET,
          ledger: state.ledger,
          sessions: state.sessions,
          progress: state.progress,
          resolveLessonId: async (slug, tenantId) => resolveLessonId(slug, tenantId),
        }),
    },
  ],
})
export class AppModule {}

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
