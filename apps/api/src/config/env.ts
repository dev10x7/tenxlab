import { z } from 'zod';

/**
 * Environment configuration for the LMS API. Values are validated at startup so
 * misconfiguration fails fast rather than at first request.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
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
    .default('http://localhost:4000/api/webhooks/lab'),
  KUBELAB_BASE_URL: z.string().default('http://localhost:8090'),

  // KubeLab control-plane credentials. KubeLab is PocketBase, whose management
  // API is admin-only, so the adapter authenticates as a KubeLab admin.
  KUBELAB_ADMIN_EMAIL: z.string().default('tenxlab@tenxlab.local'),
  KUBELAB_ADMIN_PASSWORD: z.string().default('tenxlab-dev-admin'),
  // Wildcard base for per-exercise IDE ingress hosts (ALLOWED_HOSTS in KubeLab).
  KUBELAB_ALLOWED_HOSTS: z.string().default('192.168.49.2.nip.io'),
  KUBELAB_IDE_SCHEME: z.enum(['https', 'http']).default('https'),
  // Optional public base URL that fronts per-session IDE ingress hosts, so a
  // remote browser can reach a lab whose node IP it cannot route to. When set,
  // IDE URLs are emitted as <base>/lab/<ingress-host>/. Leave unset when the
  // ingress hosts are already browser-reachable.
  //
  // A loopback base can never work: the URL is handed to the student's browser,
  // where `localhost` is the student's own machine, not the gateway. It is
  // rejected in production and warned about elsewhere (see `loadEnv`). Empty is
  // treated as unset so an unconfigured compose var does not fail validation.
  KUBELAB_IDE_PUBLIC_URL: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().url().optional(),
  ),
  // Base URL KubeLab agent pods use to fetch exercise bootstrap/check scripts.
  // Must be reachable from inside the cluster, which is not the same as the
  // browser-facing API URL on minikube.
  LAB_ASSET_BASE_URL: z.string().default('http://host.minikube.internal:4000'),

  // HMAC secret for the LMS session cookie.
  SESSION_SECRET: z.string().default('dev-session-secret'),
  // Public URL of this API, used to build links the browser follows.
  API_PUBLIC_URL: z.string().default('http://localhost:4000'),
  // Public URL of the web app, used to build browser-facing links the API emits
  // (e.g. the Safe Exam Browser start URL). Falls back to API_PUBLIC_URL.
  WEB_PUBLIC_URL: z.string().optional(),

  // When true, lab launches provision real KubeLab sandboxes. Off by default so
  // tests and catalog-only deployments never touch a cluster.
  KUBELAB_ENABLED: z
    .string()
    .default('false')
    .transform((s) => s === 'true' || s === '1'),

  // Tier-2 pod provider. When enabled, launches for `tier_2_container` lessons
  // create an isolated pod (code-server + terminal) in the cluster. Requires
  // in-cluster RBAC (see deploy/lab-operator/).
  POD_PROVIDER_ENABLED: z
    .string()
    .default('false')
    .transform((s) => s === 'true' || s === '1'),
  // Container image served to the student for a tier-2 lab.
  CODE_SERVER_IMAGE: z.string().default('codercom/code-server:latest'),

  // Tier-1 code execution pool (Piston, ADR-12) for the Editor surface.
  PISTON_BASE_URL: z.string().default('http://localhost:2000'),
  // Runtime version selector; `*` lets the pool pick the newest installed.
  PISTON_VERSION: z.string().default('*'),
  PISTON_RUN_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  // When true, the Editor's Run button is backed by Piston. Off by default so
  // tests and catalog-only deployments never call a sandbox.
  PISTON_ENABLED: z
    .string()
    .default('false')
    .transform((s) => s === 'true' || s === '1'),

  // When true, project forks provision real workspaces through the provider.
  // Off by default so tests and catalog-only deployments never touch a cluster.
  PROJECTS_ENABLED: z
    .string()
    .default('false')
    .transform((s) => s === 'true' || s === '1'),
  // Default runtime tier for a project fork when the project declares none.
  // Tier-2 keeps fork cost bounded (ADR-20); tier-3 is opt-in per project.
  PROJECTS_TIER: z
    .enum(['tier_1_microvm', 'tier_2_container', 'tier_3_vcluster'])
    .default('tier_2_container'),

  // When true, the API persists to Postgres via Prisma (the system of record).
  // Off by default so tests and catalog-only deployments use the in-memory store.
  USE_DATABASE: z
    .string()
    .default('false')
    .transform((s) => s === 'true' || s === '1'),

  // Git publish (ByteXL's Source Control push). The OAuth device flow needs only
  // the app's public client id; there is no client secret. Empty disables the
  // feature (the Nimbus UI hides the publish control).
  GITHUB_CLIENT_ID: z.string().default(''),
  // Overridable for GitHub Enterprise or tests.
  GITHUB_API_BASE: z.string().default('https://api.github.com'),
  GITHUB_OAUTH_BASE: z.string().default('https://github.com'),
  // Key material for encrypting stored third-party tokens at rest. Rotating it
  // invalidates existing connections (students must reconnect).
  TOKEN_ENCRYPTION_SECRET: z.string().default('dev-token-encryption-secret'),

  // Auto-evaluation (the SonarQube-equivalent quality run, ADR-13). The AI plane
  // is the Python FastAPI service under services/ai. Empty disables analysis:
  // the Nimbus UI hides the Analyse control and the endpoint answers
  // analysis_unavailable.
  AI_PLANE_URL: z.string().default(''),
  AI_PLANE_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),

  // Contest leaderboard backend (Phase G). When true the live standings are
  // served from a Redis sorted set (ADR-G1); otherwise an in-process index is
  // used. Off by default so unit tests never need a Redis.
  LEADERBOARD_REDIS_ENABLED: z
    .string()
    .default('false')
    .transform((s) => s === 'true' || s === '1'),
});

export type Env = z.infer<typeof EnvSchema>;

/** True for hostnames a student's browser resolves to itself, not the gateway. */
export function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '::1' ||
    hostname.endsWith('.localhost') ||
    /^127\./.test(hostname)
  );
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const env = EnvSchema.parse(source);

  // A loopback public IDE base is silently broken for every remote student: the
  // URL is composed into the browser-facing `ideUrl`, where `localhost` means
  // the student's machine. Fail loudly in production; warn in development so a
  // same-host sandbox can still run.
  if (env.KUBELAB_IDE_PUBLIC_URL) {
    const host = new URL(env.KUBELAB_IDE_PUBLIC_URL).hostname;
    if (isLoopbackHost(host)) {
      const message =
        `KUBELAB_IDE_PUBLIC_URL=${env.KUBELAB_IDE_PUBLIC_URL} is a loopback address; ` +
        'lab IDE URLs will be unreachable from a student browser. Set it to the ' +
        'public gateway host, or unset it when ingress hosts are directly routable.';
      if (env.NODE_ENV === 'production') throw new Error(message);
      // eslint-disable-next-line no-console
      console.warn(`[env] ${message}`);
    }
  }

  return env;
}
