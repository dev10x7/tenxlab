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
  **tier-3 only, unmodified**; tier-1 (Judge0/Firecracker, a request/response
  provider) and tier-2 (a plain pod) are separate `LabProvider` implementations
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
scripts/check-licenses.mjs  CI license gate
```

## Conventions

- npm workspaces (not pnpm/Go — those runtimes are unavailable here).
- TypeScript is `strict` with `noUncheckedIndexedAccess`. Index access yields
  `T | undefined`; use `?.` or a guard. This bites in tests especially.
- Each TS workspace has `pretest` -> `build`; tests run against `dist/`.
- Test runner is `node --test` (node:test). `.mjs` tests import from `dist/`.
- Business logic depends on interfaces in `apps/api/src/common/ports.ts`, never
  on Prisma directly; in-memory adapters live in `common/in-memory.ts`.
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

## Gotchas

- Clean `dist/` before trusting a test count; stale compiled tests inflate it.
- Next.js: any client component calling `useSearchParams()` must sit inside a
  `<Suspense>` boundary or `next build` fails prerendering.
- The web app proxies API calls through `apps/web/src/app/api/**` to stay
  same-origin (session cookie, no CORS).
- Lab launch is async (KubeLab cold start is minutes). Never block the request
  on provisioning; return the session id and let the UI poll.
- Inbound lab webhooks are signed with HMAC-SHA256 over the **raw** body and the
  header is `x-tenxlab-signature-256`; the payload `status` is uppercase
  (`PASSED`/`FAILED`/`ERROR`). Getting either wrong yields 401/422.
