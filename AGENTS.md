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

## Gotchas

- Clean `dist/` before trusting a test count; stale compiled tests inflate it.
- Next.js: any client component calling `useSearchParams()` must sit inside a
  `<Suspense>` boundary or `next build` fails prerendering.
- The browser never sees the launch JWT value; it is minted server-side and the
  browser only follows the KubeLab `/launch?token=` redirect.
- The web app proxies API calls through `apps/web/src/app/api/**` to stay
  same-origin (session cookie, no CORS).
