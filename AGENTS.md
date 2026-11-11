# AGENTS.md — TenXLab repository memory

Persistent, repository-specific knowledge for agents working in this repo.

## What this is

TenXLab is a multi-tenant EdTech platform: an LMS (system of record) plus a
Kubernetes execution plane for hands-on labs, modelled on ByteXL's product.
`ARCHITECTURE.md` is the authoritative design; `TenXLab_Product_Overview.md` is
the original backlog that the design supersedes where they differ.

Two deliberate deviations from the original overview:

- **No Frappe.** The LMS is Node.js (Next.js + NestJS), chosen to avoid the
  AGPL obligations of Frappe LMS.
- **Execution plane is KubeLab** (`natrontech/kubelab`, Apache-2.0), reached
  only through the provider-neutral `@tenxlab/lab-provider` interface.
- **KubeLab is adapter-only — never fork it (ADR-8, decided 2026-11-11).**
  Upstream provisioning is record-driven and binary (`clusterRunning` → Helm
  vcluster), has no tier field, and has no SSO/JWT code. So KubeLab serves
  **tier-3 only, unmodified**; tier-1 (Judge0, a request/response provider —
  ADR-12) and tier-2 (a plain pod) are separate `LabProvider` implementations
  beside it. Do not patch KubeLab's Go controller. Revisit at Phase E only if
  one exercise format across tiers is worth a rebase tax.

## Layout

```
apps/web        Next.js App Router client (student/instructor)
apps/api        NestJS LMS API (system of record)
packages/contracts       zod schemas: launch JWT, webhooks, events (source of truth)
packages/lab-provider    LabProvider interface + KubeLabAdapter
packages/runtime-policy  pure policy: tier routing, warm pool, quotas, cost
services/ai              FastAPI: plagiarism, quality, speech, webhook signer
services/lab-operator    warm-pool reconciler + idle sweeper
deploy/kubelab           KubeLab manifests + IDE gateway
deploy/stack             full-stack compose wiring + its tests
scripts/check-licenses.mjs  CI license gate
```

## Full stack (docker compose)

`docker compose up --build` brings up the whole system; see the README for the
service/port table. Points worth remembering:

- One Dockerfile per service (`apps/api`, `apps/web`, `services/ai`), each built
  from the **repo root** as context (so workspace deps resolve). Build with
  `docker compose build`, not `docker build .` from a subdirectory.
- Persistence is opt-in at run time: `USE_DATABASE=true` + `DATABASE_URL` makes
  the API use the Prisma/Postgres adapters (`common/prisma-repositories.ts`);
  otherwise it uses the in-memory store. Both satisfy `common/ports.ts`, so no
  service code branches on it.
- The API container's entrypoint runs `prisma migrate deploy` then the compiled
  seed (`dist/seed.js`) before starting, so the stack self-seeds. The seed is
  idempotent (upserts on stable ids).
- `schema.prisma` pins `binaryTargets = ["native", "debian-openssl-3.0.x"]` so
  the query engine matches `node:22-slim`. Dropping the debian target breaks the
  container with "could not locate the Query Engine".
- MinIO is behind the `storage` compose profile (opt-in) because it is not yet
  wired into the API. The default stack is postgres/redis/api/web/ai.

## Conventions

- npm workspaces (not pnpm/Go — those runtimes are unavailable here).
- TypeScript is `strict` with `noUncheckedIndexedAccess`. Index access yields
  `T | undefined`; use `?.` or a guard. This bites in tests especially.
- Each TS workspace has `pretest` -> `build`; tests run against `dist/`.
- Test runner is `node --test` (node:test). `.mjs` tests import from `dist/`.
- Business logic depends on interfaces in `apps/api/src/common/ports.ts`, never
  on Prisma directly; in-memory adapters live in `common/in-memory.ts` and the
  Postgres ones in `common/prisma-repositories.ts`. Both satisfy the same ports,
  selected by `USE_DATABASE`.
- Keep policy pure and side-effect-free (see `packages/runtime-policy`); put
  I/O behind injected ports so it stays unit-testable.

## Commands

```
npm install                 # link workspaces
npm run typecheck           # all workspaces
npm run test                # all workspaces (builds first)
npm run license:check       # copyleft gate over node_modules
cd services/ai && .venv/bin/python -m pytest -q
```

## KubeLab integration (verified live 2026-11-11)

Deployed the real KubeLab backend into minikube (`deploy/kubelab/kubelab.yaml`)
and drove the adapter against it end to end. Findings that shaped the adapter:

- KubeLab is a **PocketBase** app. Its control API is **admin-only**
  (`POST /api/admins/auth-with-password`), and provisioning is **record-driven**:
  - `PATCH /api/collections/lab_sessions/records/:id {clusterRunning:true}`
    Helm-installs a vcluster into namespace `kubelab-<lab>-<user>`.
  - `PATCH /api/collections/exercise_sessions/records/:id {agentRunning:true}`
    deploys the agent + code-server pod and two ingresses. It **400s until the
    vcluster pod exists**, so it doubles as the "cluster is up" gate; retry it.
- **`clusterRunning=true` is not idempotent.** The controller creates a
  `ResourceQuota` named `kubelab` *after* an idempotent Helm release; if the
  namespace already exists the quota create 400s. Because Helm runs first, a 400
  still means the cluster is up — the adapter tolerates it and relies on the
  agent step as the real readiness gate. Do not treat that 400 as fatal.
- The IDE is the code-server ingress host
  `kubelab-<lab>-<exerciseId>-<user>.<ALLOWED_HOSTS>`, served over **HTTPS with a
  self-signed cert** on minikube. A host-side readiness probe must fall back to
  the plain-HTTP variant (which answers 308) or it will hang on TLS.
- **No SSO/JWT code and no tier field** in KubeLab — confirms ADR-8 (adapter-only,
  tier-3 only). There is no `/launch?token=` redirect; the adapter returns the
  ingress URL and the LMS opens it.
- Cold start is **minutes**, so launch must be async: `POST /api/labs/launch`
  returns a session id immediately; the UI polls `GET /api/labs/sessions/:id`.
- The IDE ingress hosts resolve to the cluster **node IP**, which a remote
  browser cannot route to. Set `KUBELAB_IDE_PUBLIC_URL` to a gateway that fronts
  those hosts (`deploy/kubelab/ide-gateway.mjs`, path `/lab/<ingress-host>/`);
  readiness still probes the ingress directly, not the gateway.
- The gateway must **rewrite `Origin`** to the upstream ingress host before
  forwarding (`upstreamHeaders`). The browser always sends
  `Origin: https://<gateway-host>` on the WebSocket upgrade and on POSTs, and
  code-server hangs the handshake when the Origin does not match its own host —
  the IDE page loads (HTML + assets are fine) but the workbench stalls at
  "Creating a socket" and renders blank. `curl` never sends `Origin`, so this
  only reproduces in a real browser. Regression test:
  `deploy/kubelab/test/ide-gateway.test.mjs`.

## Gotchas

- Clean `dist/` before trusting a test count; stale compiled tests inflate it.
- Next.js: any client component calling `useSearchParams()` must sit inside a
  `<Suspense>` boundary or `next build` fails prerendering.
- The web app proxies API calls through `apps/web/src/app/api/**` to stay
  same-origin (session cookie, no CORS). The browser client must therefore use
  relative `/api/*` paths: never set `NEXT_PUBLIC_API_BASE_URL` (or add an `env`
  entry for it) in `next.config.mjs` — it is inlined into the client bundle at
  build time, so the browser would call that host directly and login/launch fail
  with "Something went wrong" while `curl` against the proxy still works.
- Next.js patches global `fetch` and caches route-handler responses by URL. The
  proxy must pass `cache: 'no-store'` (see `proxyFetchInit`), or a lab session
  poll replays the first `WARM` response forever and the launch never completes.
- KubeLab's `users.role` select accepts only `user`/`admin`. LMS roles
  (`student`/`instructor`) must be mapped before create or KubeLab 400s; see
  `kubelabRole` in the adapter.
- Lab launch is async (KubeLab cold start is minutes). Never block the request
  on provisioning; return the session id and let the UI poll.
- Inbound lab webhooks are signed with HMAC-SHA256 over the **raw** body and the
  header is `x-tenxlab-signature-256`; the payload `status` is uppercase
  (`PASSED`/`FAILED`/`ERROR`). Getting either wrong yields 401/422.
