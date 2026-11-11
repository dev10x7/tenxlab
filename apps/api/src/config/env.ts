import { z } from 'zod';

/**
 * Environment configuration for the LMS API. Values are validated at startup so
 * misconfiguration fails fast rather than at first request.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z
    .string()
    .default('postgresql://tenxlab:tenxlab@localhost:5432/tenxlab'),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // RS256 keypair for internal service auth (PEM). If absent, a dev keypair is
  // generated at boot — never acceptable in production.
  JWT_PRIVATE_KEY: z.string().optional(),
  JWT_PUBLIC_KEY: z.string().optional(),
  JWT_KID: z.string().default('tenxlab-lms-1'),
  LAUNCH_JWT_TTL_SECONDS: z.coerce.number().int().positive().default(7200),

  // Partner SSO: partnerId -> shared HS256 secret (JSON object string).
  PARTNER_SSO_SECRETS: z
    .string()
    .default('{}')
    .transform((s, ctx) => {
      try {
        return JSON.parse(s) as Record<string, string>;
      } catch {
        ctx.addIssue({ code: 'custom', message: 'PARTNER_SSO_SECRETS must be JSON' });
        return {};
      }
    }),

  // HMAC secret used to verify inbound webhooks (KubeLab, AI plane).
  WEBHOOK_SECRET: z.string().default('dev-webhook-secret'),

  LAB_CALLBACK_URL: z
    .string()
    .default('http://localhost:3000/api/webhooks/lab'),
  KUBELAB_BASE_URL: z.string().default('http://localhost:8090'),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return EnvSchema.parse(source);
}
