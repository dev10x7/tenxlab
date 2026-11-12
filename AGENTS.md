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
  **tier-3 only, unmodified**; tier-1 (Piston, a request/response provider —
  ADR-12) and tier-2 (a plain pod) are separate `LabProvider` implementations
  beside it. Do not patch KubeLab's Go controller. Revisit at Phase E only if
  one exercise format across tiers is worth a rebase tax.

## Layout

```
apps/web        Next.js App Router client (student/instructor)
apps/api        NestJS LMS API (system of record)
packages/contracts       zod schemas: launch JWT, webhooks, events (source of truth)
packages/lab-provider    LabProvider interface, KubeLabAdapter, PodProvider (tier-2), RoutingProvider
packages/runtime-policy  pure policy: tier routing, warm pool, quotas, cost
services/ai              FastAPI: plagiarism, quality, speech, webhook signer
services/lab-operator    warm-pool reconciler + idle sweeper (PG + k8s ports)
deploy/kubelab           KubeLab manifests + IDE gateway
deploy/lab-operator      operator RBAC + Deployment manifests
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

## P2 — Editor, Labs & Assessments (verified 2026-11-11)

The P2 exit criterion is **"a proctored exam runs end to end"**, verified by
`apps/api/src/e2e.p2.test.ts`: it boots the real Nest app and drives
login → list → start → report signals → submit → instructor review over HTTP.

- **Labs vs. Assessments** are one lesson concept split by `lesson.kind`:
  `/labs` is ungraded practice with hints (`HintReveal`); `/assessments` is
  graded and (for `mode: 'graded'`) proctored. Practice sets are never proctored.
- **The server owns the exam clock** (`assessments/exam-timer.ts`). An attempt's
  `endsAt` is stamped at start; refreshing resumes the *same* attempt so the
  deadline never moves; a submit past the deadline + 15 s grace is recorded but
  scored `expired`/zero. Never trust a client clock for the deadline.
- **Proctoring is advisory, not a verdict.** `ProctorGuard` reports what the
  browser can see (blur/focus, copy/paste, fullscreen-exit, offline); the server
  aggregates weighted events into a risk score (`proctoring.service.ts`,
  `REVIEW_THRESHOLD = 30`). The UI shows signals for a human to judge — do not
  auto-fail a student on a score. Video/webcam and full SEB are out of v1
  (ADR-15/ADR-17); `buildSebConfig` stays in the codebase for later.
- Assessment list/get/start/submit and proctoring summary are **instructor/tenant
  scoped**: a student gets 403 on another attempt's summary, and review reads
  filter through the reviewer's tenant memberships.
- Coding questions grade through the same tier-1 `CodeExecutionProvider` as the
  Editor; the read-only stub region is enforced *before* the code runs. With the
  runner off, a coding question scores 0 rather than failing the attempt.

## Tier-1 execution (Piston) — license-verified 2026-11-11

Tier-1 (single-file DSA code) is served by **Piston** (`engineer-man/piston`,
**MIT**), not Judge0. ADR-12 originally named Judge0 and recorded it as
"Apache-2.0"; that was wrong — Judge0 CE is **GPL-3.0**, which ADR-7 forbids in
the product image. Piston is MIT, lighter (no Postgres/Redis), and fits the same
request/response tier-1 contract.

- Piston sandboxes with **Isolate** (GPL-2.0) inside its own container, invoked
  over HTTP. Never link or bundle it — treat Piston as an external service, like
  KubeLab. Verify any new runtime's license before adding it (this mistake is why
  the ADR existed in prose but the license was never checked).
- Piston defaults (3 s CPU, 1024-char stdout) are too tight for teaching; raise
  `run_timeout` / output caps per exercise. These are **server ceilings**, not
  requests: sending `run_timeout` above the configured limit makes Piston 400 the
  whole run (`"run_timeout cannot exceed the configured limit of N"`). The
  provider retries once without explicit limits when it sees that message, so a
  stock Piston (3 s ceiling) still works with the API's 5 s default — keep that
  fallback if you touch `piston.provider.ts`.
- The editor widget is **CodeMirror 6** (MIT), per ADR-19 — a single-pane
  practice playground, not an IDE. Monaco stays the fallback only if the Editor
  must feel identical to the lab's code-server workbench.
- The tier-1 seam is `CodeExecutionProvider` (`packages/lab-provider`), **not**
  `LabProvider`: a run is request/response, a lab is a long-lived session. Do
  not force Piston into the session model.
- Piston runs untrusted code, so its compose service sits behind the `runner`
  profile (`docker compose --profile runner up`) and is off by default; the
  API's `PISTON_ENABLED` gates the Run button. With it off, the Editor still
  serves languages and snippets — only Run returns 503.
- The Editor language catalog is curated (`EDITOR_LANGUAGES` in
  `packages/contracts`): each entry pairs a Piston runtime alias with a
  CodeMirror id and a starter template. Add a language there *and* import its
  `@codemirror/lang-*` package in `apps/web/src/components/CodeEditor.tsx`;
  every one is MIT, so `license:check` stays green.

## Gotchas

- Clean `dist/` before trusting a test count; stale compiled tests inflate it.
- Enrolment is keyed on `(userId, courseId)` (unique), so re-assigning the same
  student+course to a *different* batch moves the enrolment rather than adding a
  second roster row. `BatchService.assign` is idempotent by design.
- Course ids are derived from the catalog slug via `courseIdForSlug` in
  `catalog/demo-data.ts`; the seed, the catalog DTO, and enrolment all use it, so
  they must stay in step.
- Next.js: any client component calling `useSearchParams()` must sit inside a
  `<Suspense>` boundary or `next build` fails prerendering.
- The web shell (`AppShell`) lives in the root layout and persists across
  routes, so it re-reads the session on `pathname` change; without that the top
  bar stays "Sign in" after a client-side login. The nav itself is data, not
  JSX: edit `apps/web/src/lib/nav.ts`, and keep `nav.test.mjs` in sync. A menu
  entry with a `phase` badge is a placeholder — it must render through
  `SurfacePage` rather than a blank route.
- The web app proxies API calls through `apps/web/src/app/api/**` to stay
  same-origin (session cookie, no CORS). **Every browser-facing API route needs a
  matching route handler there** — adding a Nest controller alone is not enough,
  or the page 404s in the browser while `curl` against the API still works. The
  browser client must therefore use relative `/api/*` paths: never set
  `NEXT_PUBLIC_API_BASE_URL` (or add an `env` entry for it) in
  `next.config.mjs` — it is inlined into the client bundle at
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
- The IDE URL the adapter emits is a per-session ingress hostname that resolves
  to the cluster node IP, which a remote browser cannot route to. Set
  `KUBELAB_IDE_PUBLIC_URL` to the public gateway host and run
  `deploy/kubelab/ide-gateway.mjs` (port 12001) so emitted URLs are
  `<gateway>/lab/<ingress-host>/...`; readiness still probes the ingress
  directly.
- Inbound lab webhooks are signed with HMAC-SHA256 over the **raw** body and the
  header is `x-tenxlab-signature-256`; the payload `status` is uppercase
  (`PASSED`/`FAILED`/`ERROR`). Getting either wrong yields 401/422.
- Lab execution is tier-routed. `PROVIDER` in `apps/api/src/http/app.module.ts`
  is a `RoutingProvider`, not a bare `KubeLabAdapter`: `tier_3_vcluster` →
  KubeLab (adapter-only, ADR-8), `tier_2_container` → our `PodProvider`. Each
  route is gated by env (`KUBELAB_ENABLED`, `POD_PROVIDER_ENABLED`); with none
  set the provider is `null` and launches record a catalog-only session. A tier
  with no route fails loudly rather than silently no-op'ing.
- `PodProvider.provider_ref` is the session's **namespace** and doubles as the
  session id for status/terminate, so `namespaceFor` is idempotent (it accepts
  an already-prefixed name). Changing that breaks terminate-after-status.
- The operator (`services/lab-operator`) drives the warm pool through
  `OperatorPorts`. The concrete `PgOperatorPorts` owns `lab_sessions` (read for
  the idle sweep) and `warm_sandboxes` (its inventory); `KubernetesClient`
  talks to the API server directly (no `@kubernetes/client-node`, keeps the
  dependency surface and license gate small). Ticks are serialised so the pool
  does not double-boot; `RECONCILE_ONCE=1` runs one tick for a CronJob.
- The operator needs cluster-wide RBAC (it creates/deletes per-session
  namespaces); `deploy/lab-operator/operator.yaml` grants it. Compose runs it
  under the `operator` profile and mounts `KUBECONFIG` read-only.
