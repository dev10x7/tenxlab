import { Module } from '@nestjs/common';
import { generateKeyPairSync } from 'node:crypto';
import { loadEnv, type Env } from '../config/env';
import { JwtService } from '../crypto/jwt.service';
import { PartnerSsoService } from '../identity/partner-sso.service';
import { LabLaunchService } from '../labs/lab-launch.service';
import { GradebookWebhookService } from '../gradebook/gradebook-webhook.service';
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
  JwksController,
  LabController,
  PartnerSsoController,
  WebhookController,
} from './controllers';
import { ENV, GRADEBOOK, JWT, LAUNCH, SSO } from './tokens';

export { ENV, GRADEBOOK, JWT, LAUNCH, SSO };

const DEMO_TENANT = {
  id: 'demo-tenant',
  name: 'Demo College',
  domain: 'demo-college',
  maxConcurrentLabs: 50,
  plan: 'standard',
  status: 'active',
};

/**
 * Local development wiring. Uses in-memory repositories seeded with a demo
 * tenant/lesson so the API is runnable without Postgres. Production replaces
 * these providers with Prisma-backed adapters (see prisma/schema.prisma).
 */
@Module({
  controllers: [
    JwksController,
    PartnerSsoController,
    LabController,
    WebhookController,
  ],
  providers: [
    { provide: ENV, useFactory: () => loadEnv() },
    {
      provide: JWT,
      inject: [ENV],
      useFactory: (env: Env) => {
        const keys =
          env.JWT_PRIVATE_KEY && env.JWT_PUBLIC_KEY
            ? {
                privateKey: env.JWT_PRIVATE_KEY,
                publicKey: env.JWT_PUBLIC_KEY,
                kid: env.JWT_KID,
              }
            : devKeys(env.JWT_KID);
        return new JwtService(keys, env.LAUNCH_JWT_TTL_SECONDS);
      },
    },
    {
      provide: SSO,
      inject: [ENV],
      useFactory: (env: Env) =>
        new PartnerSsoService(
          new InMemoryTenantRepository([{ ...DEMO_TENANT }]),
          new InMemoryUserRepository(),
          new InMemoryMembershipRepository(),
          new InMemoryReplayGuard(),
          { secrets: env.PARTNER_SSO_SECRETS, jitProvisioning: true },
        ),
    },
    {
      provide: LAUNCH,
      inject: [ENV, JWT],
      useFactory: (env: Env, jwt: JwtService) =>
        new LabLaunchService({
          jwt,
          lessons: new InMemoryLessonRepository([
            {
              id: 'demo-lesson',
              moduleId: 'demo-module',
              title: 'Create a Pod',
              type: 'interactive_lab',
              exerciseSlug: 'create-simple-pod',
              runtimeTier: 'tier_3_vcluster',
              maxScore: 100,
            },
          ]),
          memberships: new InMemoryMembershipRepository([
            {
              id: 'demo-membership',
              userId: 'demo-user',
              tenantId: 'demo-tenant',
              role: 'student',
              status: 'active',
            },
          ]),
          tenants: new InMemoryTenantRepository([{ ...DEMO_TENANT }]),
          sessions: new InMemoryLabSessionRepository(),
          callbackUrl: env.LAB_CALLBACK_URL,
          kubelabBaseUrl: env.KUBELAB_BASE_URL,
        }),
    },
    {
      provide: GRADEBOOK,
      inject: [ENV],
      useFactory: (env: Env) =>
        new GradebookWebhookService({
          webhookSecret: env.WEBHOOK_SECRET,
          ledger: new InMemoryEventLedger(),
          sessions: new InMemoryLabSessionRepository(),
          progress: new InMemoryProgressRepository(),
          resolveLessonId: async (slug, tenantId) =>
            slug === 'create-simple-pod' && tenantId === 'demo-tenant'
              ? 'demo-lesson'
              : null,
        }),
    },
  ],
})
export class AppModule {}

function devKeys(kid: string) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { privateKey, publicKey, kid };
}
