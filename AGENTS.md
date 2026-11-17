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
packages/contracts       zod schemas: launch JWT, webhooks, events, projects (source of truth)
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

### Real-cluster bring-up (verified live 2026-11-12)

Labs serve from a **real KubeLab on minikube**, not the stub. Verified end to
end: login → launch (`tier_3_vcluster`) → WARM → **ACTIVE** → "Open your lab
environment" → the code-server IDE boots in a real browser with the `exercise`
workspace (`pod.yaml` seeded by bootstrap) and a working `kubectl` against the
per-session **vcluster**. Reproduce:

1. `sg docker -c "minikube start --driver=docker --cpus=2 --memory=6g --kubernetes-version=v1.31.0 --addons=ingress"`.
   The `ingress` addon is required — KubeLab's IDE/agent ingresses need an
   ingress controller. Node IP is `192.168.49.2`.
2. `sg docker -c "kubectl apply -f deploy/kubelab/kubelab.yaml"`.
3. Port-forward the control plane and create the admin the adapter logs in as:
   `sg docker -c "kubectl -n kubelab port-forward svc/kubelab-service 8090:8090"`,
   then `POST /api/admins` with `KUBELAB_ADMIN_EMAIL` / `KUBELAB_ADMIN_PASSWORD`
   (idempotent only the first time — it 400s if the admin already exists).
4. Start the API with `KUBELAB_ENABLED=true`, `KUBELAB_BASE_URL=http://localhost:8090`,
   `LAB_ASSET_BASE_URL=http://host.minikube.internal:<api-port>` (the agent pod
   fetches `bootstrap.sh`/`check.sh` from the LMS at this URL; `host.minikube.internal`
   is how the cluster reaches the host), and `KUBELAB_IDE_PUBLIC_URL` set to the
   public gateway.

**Public port layout** (the sandbox exposes only work-1 → 12000 and work-2 → 12001):

- **12000** — `apps/web` (`next start -p 12000`, `API_BASE_URL=http://localhost:4000`).
- **4000** — `apps/api` (internal; web proxies `/api/*` to it).
- **12001** — the IDE gateway (`IDE_PROXY_PORT=12001 node deploy/kubelab/ide-gateway.mjs`).
  `KUBELAB_IDE_PUBLIC_URL=https://work-2-…` so browser IDE URLs are
  `<work-2>/lab/<ingress-host>/`.

The API must **not** bind 12001 — it would shadow the gateway (the adapter then
still reports ACTIVE, but the IDE URL 404s). One API process only: a stale
`node dist/main.js` on the port silently breaks the gateway.

The exercise workspace can be inspected directly:
`kubectl -n <lab-ns> exec <agent-pod> -c code-server -- kubectl get pods`.

### Startup scripts (verified live 2026-11-13)

`scripts/dev-up.sh` brings the whole stack up in one shot — Docker daemon →
minikube (+ingress) → KubeLab → IDE gateway → API → web — and is idempotent, so
re-running it only starts what is down. Companions:

- `scripts/dev-up.sh --status` — report each component up/down.
- `scripts/dev-smoke.sh [--no-lab]` — drive the two exit criteria over real
  HTTP: the project fork → build → stop → submit → evaluate loop, and the
  tier-3 lesson launch → vcluster ACTIVE with a browser-reachable IDE URL.
  `--no-lab` skips the multi-minute vcluster leg.
- `scripts/dev-down.sh [--all]` — stop the app processes (keeps minikube);
  `--all` also stops minikube and Docker.

Things the script encodes that bite when done by hand:

- **Docker group.** The socket is `root:docker`. Right after `usermod -aG docker`
  the current shell is still outside the group, so `docker`/`minikube`/`kubectl`
  fail with "permission denied". The script detects this and wraps those commands
  in `sg docker -c '...'` (no re-login needed). Set `DOCKER_WRAP="sg docker"` to
  force it.
- **Tier-2 pod provider auth.** The demo project forks a `tier_2_container`
  workspace served by our `PodProvider`, which talks to the API server directly.
  Off-cluster it needs a token, so the script applies `deploy/lab-operator/rbac.yaml`,
  mints a ServiceAccount token (`kubectl -n tenxlab-system create token …`), and
  writes a self-contained kubeconfig to `$LOG_DIR/kubeconfig-token.yaml`
  (`server` + `token` + `certificate-authority-data`). The parser in
  `packages/lab-provider` only understands those three fields — it ignores
  client-certificate kubeconfigs, so minikube's default `~/.kube/config` will not
  work for the pod provider.
- **Namespace RBAC needs `patch`.** Resume (re-fork of a stopped workspace)
  re-applies the namespace, and `apply()` PATCHes an object that already exists.
  A ClusterRole with only `create` on `namespaces` makes resume fail with
  `403 … cannot patch resource "namespaces"`. The role grants
  `get,list,watch,create,update,patch,delete`.
- **Namespace deletion is async.** `terminate` deletes the namespace but it
  lingers in `Terminating` while resources finalise; a resume that re-applies
  immediately races that state and 403s. `PodProvider.terminate` now blocks until
  the namespace is actually gone (`terminateTimeoutMs`/`terminatePollMs`).
- **`KUBERNETES_SERVICE_HOST` is set in the sandbox.** The dev container itself
  runs inside a pod, so `KubernetesClient` prefers the *in-cluster* path and
  targets the wrong cluster (10.3.0.1). The script launches the API with
  `env -u KUBERNETES_SERVICE_HOST -u KUBERNETES_SERVICE_PORT` so it falls back to
  the token kubeconfig. This is why the pod provider hung on the first attempt.
- **Ingress webhook race.** `kubectl apply` of KubeLab fails with
  `failed calling webhook "validate.nginx.ingress.kubernetes.io"` if applied
  before the ingress controller is Ready. The script waits for the controller,
  then re-applies.
- **KubeLab admin create is not idempotent.** `POST /api/admins` 400/401s once any
  admin exists, so the script verifies by calling `auth-with-password` instead of
  by the create status.
- **Status casing differs by surface.** Lab session status is uppercase
  (`WARM`/`ACTIVE`/`FAILED`); project workspace status is lowercase
  (`provisioning`/`running`/`stopped`/`failed`). Compare case-insensitively in
  scripts.
- **A `running` workspace may still be pulling.** The provider flips to `running`
  when the ingress exists; the code-server image pull means the ingress answers
  `503` for a while. Probe the IDE URL until it stops returning 503/000.

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

## Student dashboard & ByteXL-style navigation (2026-11-11)

The student portal mirrors ByteXL's layout: a **global header** (in `AppShell`:
notifications + platform-settings actions, role pill, display name, sign out)
above a **left-panel** menu of sections. The menu is data in
`apps/web/src/lib/nav.ts`; keep `nav.test.mjs` in sync when you touch it.

- **Student sections, in order:** `Home` (Dashboard, Feed), `Learning` (AI
  Mentor, Courses→`/learn`, Catalog→`/catalog`, Classes), `Practice` (Editor,
  Labs, Assessments), `Nimbus` (build→`/nimbus`, Submissions→`/nimbus/submissions`,
  Apps→`/nimbus/apps`), `Insights` (Student Reports, Resumes, AI Interviewer),
  `Community` (Social, Help→`/help/student`). The `Feed`, `Social`, and
  `Student Reports` entries are P3 placeholders and render through
  `SurfacePage`; `Classes` and `Help` are live.
- **The dashboard is a three-panel view** (`app/dashboard/page.tsx`): the header
  (shell), a main column of **industry roadmaps** + **competitive rankings**
  (university + batch), and a right rail with the **profile-completion** nudge.
  Its data comes from `GET /api/dashboard` → `DashboardService`
  (`apps/api/src/dashboard/dashboard.service.ts`), which is pure over the
  injected ports so every number is unit-testable.
- **`DashboardService` inputs:** enrolments (via the new
  `EnrollmentRepository.listByUser`), the caller's `lesson_progress`, tenant
  student memberships (university cohort), and the batch roster (batch cohort).
  Rankings use competition ranking (ties share the better rank) and read the
  same progress rows the instructor gradebook reads, so a lab-webhook score
  moves both. Profile completion is a fixed 7-item checklist (enrolled, started
  a lesson, completed a lesson, saved a snippet, created a workspace, submitted
  a project, connected GitHub) — extend the list in one place.
- **The dashboard is student-only.** `DashboardController` returns 403 for
  instructor/admin sessions, so the page first reads the session and renders a
  redirect to the staff home (`/grading`, `/admin/users`) rather than firing a
  doomed request; instructor/admin nav keeps its own layout.
- **Nimbus sub-surfaces:** `/nimbus/submissions` lists the student's submitted
  workspaces with trainer score, auto-evaluation, and feedback (the LMS side of
  the flow, mirroring ByteXL); `/nimbus/apps` lists forked workspaces and their
  live `deployUrl`/`ideUrl`. Both are read-only views over existing endpoints —
  no new API was added for them.
- **The Nimbus landing is one consolidated view (E6e).** `/nimbus` (student)
  renders `nimbusLanding()` (`apps/web/src/lib/lms.ts`) — a pure fold of
  projects + per-fork statuses + submissions into `{ workspaces, openProjects,
  counts }` — so the page stays a thin renderer. It shows a count strip and a
  "Your workspaces" grid whose cards carry the quick actions (open / stop /
  **Publish app** / download / delete); publish is one click (default port,
  inline override) against the existing `deploy` endpoint.
- **Workspace quick actions act on `workspaceId`, not `forkId`.** `nimbusLanding`
  rows carry both; deploy/undeploy/download/stop/delete all key off
  `workspaceId` (the fork id is only for the `/nimbus/workspace/[forkId]` link).
- **A resume restores `ideUrl`.** `stopWorkspace` nulls `ideUrl`; re-forking a
  stopped workspace scales the workload back up and re-reads the provider
  (`ProjectService.resume`) so the IDE URL returns, rather than staying null
  until the next full re-fork.
- **AI-suggested project copy (`POST /api/projects/suggest-copy`).** A
  deterministic, no-LLM suggester: the AI plane's `POST /v1/copy/suggest`
  (`services/ai/app/copy.py`) derives a title + one-line description from the
  hint, stacks, and component titles; the API's `ProjectCopyService`
  (`projects/copy.service.ts`) normalises + caps the input (12 stacks/12
  components, 200-char hint) and returns `{ ok: false, reason: 'unavailable' }`
  when the AI plane is off (`AI_PLANE_URL` empty), so the form degrades rather
  than errors. `AiBridgeClient` implements the `CopySuggester` seam; the web
  client calls it via the `/api/projects/suggest-copy` proxy. Surfaced as
  "Suggest title & description with AI" on the instructor create-project form
  and the student submission form.
- **Nested route highlight:** `activeHref` matches by longest prefix, so
  `/nimbus/submissions` highlights the nested item, not `/nimbus`.
- **Collapsible sidebar:** the sidebar collapses to an icons-only rail via the
  toggle in `.sidebar-head`; the state lives on `.shell.sidebar-collapsed` and is
  persisted under `tenxlab.sidebar.collapsed` in `localStorage`. Collapsed, the
  labels/section titles are hidden and each link carries a `title` for hover.
- **The IDE opens in the main panel:** the Nimbus workspace view is
  `/nimbus/workspace/[forkId]` (`app/nimbus/workspace/[forkId]/page.tsx`), which
  polls the fork and frames `ideUrl` in `.ide-frame` once it is ready, with an
  "Open in new tab" fallback. `ProjectComponentCard` links here ("Open
  workspace"). For the frame to load, the `ide-gateway` strips `X-Frame-Options`
  and any CSP `frame-ancestors` (`sanitizeResponseHeaders` in
  `deploy/kubelab/ide-gateway.mjs`) — code-server otherwise refuses to be
  embedded.

## Report an Issue / support desk (2026-11-11)

ByteXL's help centre exposes an in-app "Report an Issue" form; ours now mirrors
it end to end.

- **Domain:** `apps/api/src/support/support.service.ts` — `SupportService` over
  the `SupportIssueRepository` port (`common/ports.ts`), with
  `SUPPORT_CATEGORIES = bug | feature | question | other` and
  `SUPPORT_STATUSES = open | in_progress | resolved`. The service validates
  (title/description required, description length cap, known category/status)
  and returns a discriminated result (`{ ok, reason }`) rather than throwing;
  the controller maps each reason to its HTTP status.
- **HTTP:** `SupportController` (`http/controllers.ts`, `@Controller('api/support')`)
  — `POST /issues` (any signed-in member), `GET /issues` and
  `PATCH /issues/:id` (instructor/admin only, **tenant-scoped**: the list and
  every status change filter through the caller's tenant, so a cross-tenant id
  is a 404, never a leak).
- **Persistence:** table `support_issues`
  (`prisma/migrations/20261122000000_support_issues`) with the
  `PrismaSupportIssueRepository` adapter; `InMemorySupportIssueRepository`
  keeps the same behaviour for tests.
- **Web:** `/support` (`app/support/page.tsx`) — a report form that captures
  `window.location.pathname` as `pageUrl`, plus a support queue for
  instructors/admins. It calls a catch-all proxy
  (`app/api/support/[...path]/route.ts`) so the session cookie stays
  same-origin; one proxy covers POST/GET/PATCH.
- **Nav:** `SUPPORT` is added to the Community (student) and More/Insight
  (instructor/admin) sections in `lib/nav.ts`; `nav.test.mjs` asserts it.
- **Conventions to remember:** the success notice uses `<p className="muted">`
  (there is no `.success` class), and secondary buttons use `.btn secondary`
  (there is no `.btn ghost`). Support status pills use `.pill open/in_progress/
  resolved`.

## Safe Exam Browser `.seb` download (2026-11-11)

- `GET /api/assessments/:id/seb` streams `buildSebConfig()` as
  `application/seb` with a `content-disposition: attachment; filename="<id>.seb"`.
  A non-proctored assessment is a 400, an unknown id a 404, and an anonymous
  caller a 401 (the route is session-gated like the rest of the controller).
- The assessments page offers a **Download SEB config** button on proctored
  tests; the web proxy `app/api/assessments/[id]/seb/route.ts` forwards the
  bytes through `proxyBinary` (not the text proxy) so the binary and its
  `content-disposition` survive.
- `startURL` is built from `WEB_PUBLIC_URL` (falls back to `API_PUBLIC_URL`),
  which compose sets to `http://localhost:3000`; without it the start URL points
  at the API host.
- Still deferred (ADR-17): the **quit password** (ByteXL gates it on
  `test:edit`), kiosk/network-filtering enforcement (that is SEB's job once it
  opens the config), and video proctoring (ADR-15).

## Help centre (role guides, 2026-11-11)

- **Two role pages, one content module.** `/help/student` and
  `/help/instructor` (`app/help/<role>/page.tsx`) both render
  `RoleHelpPage` (`components/RoleHelpPage.tsx`) from `STUDENT_GUIDES` /
  `INSTRUCTOR_GUIDES` in `apps/web/src/lib/help.ts`. Each guide is data — a
  title, summary, the live `route`, a `screenshot` filename, and an ordered
  `steps` list — so the hub, the pages, and the tests share one source.
- **Screenshots are real, checked-in captures** under `apps/web/public/help/`,
  named `<role>-<feature>.png`. `help.test.mjs` fails if a guide references a
  screenshot that is not on disk or a route that is not in that role's nav.
- **Regenerate after a UI change:** `npm run shots:help` (needs the stack up and
  Playwright's Chromium; `scripts/shots/capture-help.mjs` seeds a couple of
  attendance rows first so the instructor matrix is not empty).
- **The Docker web image must copy `public/`** — `next start` serves static
  assets from there. `apps/web/Dockerfile` copies `apps/web/public` into the
  runner stage; without it every screenshot 404s in the container.
- **Wiring:** `nav.ts` exposes `helpHref(role)` (instructor/admin →
  `/help/instructor`, else `/help/student`) and adds the role's help item to the
  sidebar; `AppShell` also renders a top-bar `?` shortcut to `helpHref`.
  `activeHref` keeps the role item lit on the shared `/help` hub.
- **Attendance needs a web proxy.** The `/classes` surface calls
  `/api/attendance/*`, served by a catch-all proxy at
  `app/api/attendance/[...path]/route.ts` (same shape as `authoring`); without
  it the student and trainer attendance views both error.
- **Reusable tooling:** the whole flow (scaffold the pages, capture the
  screenshots, verify them) is packaged as the `help-centre` skill under
  `.agents/skills/help-centre/`. Prefer its `scripts/*.mjs` over re-writing
  this by hand; see `SKILL.md` and `references/worked-example.md`.

## Course authoring (2026-11-19)

The catalog is now **repository-backed** — the demo array is seed input only.
Instructors build a course as a tree of **modules** (chapters) and **lessons**,
then **publish** it so students see it in `/catalog` and `/learn`.

- **Domain:** `CourseRecord`/`ModuleRecord` and the extended `LessonRecord`
  (authoring fields: `body`, `hint`, `assessmentId`) live in
  `common/ports.ts`, with `CourseRepository`/`ModuleRepository` on `Repositories`
  and both in-memory (`common/in-memory.ts`) and Prisma
  (`common/prisma-repositories.ts`) impls. Migration
  `20261119000000_course_authoring` adds `Course.slug` and the lesson columns.
- **Reads:** `CatalogService` takes `(courses, modules, lessons, progress)` and
  only returns **published** courses, so a draft never reaches a student.
- **Writes:** `CourseAuthoringService` (`catalog/course-authoring.service.ts`)
  is pure over the ports and tenant-scoped — every id is resolved through the
  owning course, so guessing an id cannot cross tenants. It owns the
  draft→published lifecycle (`publish`/`unpublish`) and `slugify` (unique slug
  per tenant; a clash is `slug_taken`).
- **HTTP:** `CourseAuthoringController` (`/api/authoring/...`) gates every call
  on the `course:write` capability via `requireCapability` (`http/guards.ts`).
  A student session gets 403; the DTOs are `CourseEditorDto`/`ModuleEditorDto`/
  `LessonEditorDto`.
- **Web:** `/authoring` (course list, drafts included) → `/authoring/[courseId]`
  (course editor: edit details, add/delete chapters and lessons, publish). The
  client methods are `api.authoringCourses`/`createCourse`/`addModule`/
  `addLesson`/`publishCourse`/… in `apps/web/src/lib/api.ts`. One catch-all proxy
  handler (`app/api/authoring/[...path]/route.ts`) forwards every verb to the API
  — a new browser-facing authoring route needs no extra file.
- **Enrolment → course resolution is repository-backed (2026-11-19).** Both
  consumers of a stored `courseId` — the student dashboard's roadmaps and the
  instructor gradebook's columns — resolve through `CourseCatalog`
  (`catalog/course-catalog.ts`, built by `courseCatalogFrom` over the
  `CourseRepository`/`ModuleRepository`/`LessonRepository` ports). The catalog
  walks course → modules → lessons on each read, so a course an instructor
  authored a minute ago reaches a roadmap and a gradebook exactly like a seeded
  one. The gradebook's columns are now the distinct lessons of the batch's
  enrolled courses, not a fixed list. `DEMO_COURSES` is now **seed input only**
  (`seed.ts`, `demo/state.ts`) — no service reads it to resolve a course.
- **Known limitation:** the gradebook renders one flat column list per batch —
  the union of its enrolled courses' lessons in enrolment order. A batch that
  mixes courses therefore shows both courses' lessons side by side rather than
  grouping columns by course. Fine while a batch is single-course in practice.

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
- Piston runs untrusted code, so its compose service is `privileged` and starts
  by default with the rest of the stack; the API's `PISTON_ENABLED` gates the Run
  button (it is `true` in compose). With it off, the Editor still serves
  languages and snippets — only Run returns 503.
- `piston-init` (compose) installs the Editor's runtimes into Piston on first
  boot and is idempotent, so later boots are cheap. The stock Piston image ships
  only six runtimes (`python`, `javascript`, `java`, `c`, `c++`, `sqlite3`); the
  Editor catalog is larger, so the init container POSTs the missing ones to
  `/api/v2/packages` — keep that list in sync with `EDITOR_LANGUAGES`. Note that
  Piston *package* names differ from runtime aliases: install `node` for
  JavaScript, `gcc` for C/C++, `mono` for C#.
- `scripts/dev-up.sh` brings Piston up itself (step 4b) and starts the API with
  `PISTON_ENABLED=true`, so the Editor's Run works in the dev stack. If compose
  is unavailable the step warns and the API falls back to Run → 503.
  Check what is installed with `GET /api/v2/runtimes`.
- The Editor language catalog is curated (`EDITOR_LANGUAGES` in
  `packages/contracts`): each entry pairs a Piston runtime alias with a
  CodeMirror id and a starter template. Add a language there *and* import its
  `@codemirror/lang-*` package in `apps/web/src/components/CodeEditor.tsx`;
  every one is MIT, so `license:check` stays green.
- The Editor AI assistant has **two tutor modes** (`services/ai/app/tutor.py`,
  `TutorMode`): `assist` explains the error *and* returns corrected code (ByteXL
  parity, §1.6) and is the practice-editor default; `socratic` returns the root
  cause plus a guiding question and **never** a pasteable solution. The seam is
  `CodeReviewer` in `ai-bridge.client.ts`; `EditorService.review()` maps the
  language id and forwards the student's `stderr`. Only `socratic` may be
  reachable from a graded assessment — keep that boundary when wiring it in.

## Phase E — Projects / Nimbus equivalent (E0–E4 landed 2026-11-14)

The ByteXL "Nimbus" equivalent: an instructor-authored `Project` that a student
**forks** into a durable `ProjectWorkspace`, builds in an online VS Code, and
**submits** (title, description, workspace, optional GitHub/demo links) for a
trainer to score. Plan and competitor research: `docs/BYTEXL_PARITY_ANALYSIS.md`.
The surface is live at `/nimbus` for both roles (student: fork → build → stop →
submit; instructor: author → publish → evaluate).

**Release-video refresh (2026-11-14).** The monthly release videos were
transcribed (see `docs/BYTEXL_PARITY_ANALYSIS.md` §1.5/§2.10). Beyond E0–E5 they
add: a Nimbus **landing dashboard** (workspaces + deployed apps + live projects,
deploy/download/delete quick actions), **database workspaces**
(MySQL/Postgres/SQL Server/Mongo), a **visual AI Mentor** (diagrams + images),
**university/batch ranks** + a **profile-completion tile**, an **exam start
passcode**, and **Clarity** — a standalone CEFR-graded English-communication
product. The parity-blocking subset has shipped: **E6b** (exam start passcode),
**E6c** (database templates + category grouping), **E6** (Up Next / Resume,
attendance, ranks, profile tile, and the fork-card deploy/download/delete quick
actions). The **visual AI Mentor** and **Clarity** (CEFR) are folded into Phase
F; the standalone **landing dashboard** view and any remaining polish into Phase
G.

- **E0 = domain + persistence only** (this commit). Contracts in
  `packages/contracts` (`Project`, `ProjectComponent`, `ProjectTemplate`,
  `ProjectWorkspace`, `ProjectFork`, `ProjectSubmission`,
  `ProjectSubmissionInput`); ports + records in `common/ports.ts`; in-memory and
  Prisma adapters wired through `Repositories` and both `demo/state.ts`
  factories; models + migration `20261114000000_projects`; a `DEMO_PROJECT` seed
  and a template registry (`projects/templates.ts`). No service or HTTP surface
  yet — that is E1–E4.
- **E1 = fork lifecycle** (`projects/project.service.ts`, this commit). Mirrors
  `LabLaunchService`: validate membership + `published` status, resolve the
  component's template (catalog slug or source workspace), create a
  `ProjectWorkspace` + `ProjectFork`, then provision through the injected
  `LabProvider` **asynchronously** — the caller polls `getForkStatus` until the
  workspace is `running` with an `ideUrl`. Re-forking re-attaches to the
  existing workspace; a failed provision is `failed`, never `stopped`. Gated by
  `PROJECTS_ENABLED` (off ⇒ no cluster) and `PROJECTS_TIER` (default tier-2).
  Stop/resume and the fork expiry policy land with E5b; the HTTP surface is E4.
- **A project is a container of components, not a single template.** Each
  `ProjectComponent` is one technology slot (ByteXL's "add individual workspaces
  to it" step); a student forks *each* component into its own workspace and
  submits *per component*, so a multi-service app is N independent workspaces
  wired by the student (§1.4), never one composed stack. A component's template
  is either a catalog `templateSlug` or an existing `templateWorkspaceId`
  (fork-your-own, §1.3). Forks are unique per `(componentId, userId)`.
- **Forks must not land in `lab_sessions`.** The lab-operator's 30-min idle
  sweep would reap a student's long-lived workspace, so project state lives in
  its own tables with its own expiry policy (**ADR-20**).
- **Stop-when-idle is a data-model property, not an afterthought**: a
  `ProjectWorkspace` carries `storageRef` (the durable volume) separately from
  `ideUrl` (the running compute), so `status: 'stopped'` keeps the files and
  drops the compute. Snapshot on stop, restore on resume.
- **Two template shapes** (parity §1.4): `framework` (dependency-ready Flask /
  Java / Spring Boot / Spring+Mongo / React) and `base_image` (bare Debian, no
  language, `apt` available — the "Alpine/NOS" case). A multi-service app is
  **N independent workspaces wired by the student**, not one composed stack.
- **No hosted git** (parity §1.3): a fork copies an in-platform scaffold; git is
  workspace-local (`git init`/`config` in the IDE); publish is a GitHub OAuth
  device-flow push to the student's own account. Keep GitHub/demo URLs on the
  submission as optional free-text links.
- **Submission is LMS-nav, not IDE.** Deadlines are server-authoritative and
  auto-close the project; submission snapshots a *closed* workspace (the
  stop-before-submit rule ByteXL surfaces as a "session closing" wait).
- **E2–E4 = authoring, submission, HTTP surface, and the `/nimbus` UI.**
  `ProjectService` gained `listForUser`/`listForInstructor` (tenant-scoped),
  `getProjectView`, `createProject`, `addComponent`, `publishProject`, and
  `stopWorkspace` (resume is the existing fork re-attach). `ProjectSubmissionService`
  (`projects/project-submission.service.ts`) owns submit/list/evaluate: it
  rejects a running workspace (`workspace_active`), a passed deadline, a
  non-`published` project, and a workspace that is not the caller's own fork;
  resubmitting replaces the prior row (one per `(component, student)`). Scores
  are bounded by `project.maxScore`. `ProjectsController` gates authoring
  (create/add-component/publish/templates) behind `requireInstructor`; student
  reads are scoped to their own forks and submissions. **Route order matters**:
  the static `templates`, `submissions`, `forks/:forkId`, and
  `workspaces/:workspaceId/stop` routes must be declared before `:id`, or Nest
  matches `:id` first. DI: `PROJECT` (needs `provider`, off when
  `PROJECTS_ENABLED` is unset) and `PROJECT_SUBMISSION`. Every browser-facing
  route has a matching proxy under `apps/web/src/app/api/projects/**`.
- **E5 = one-click hosting** (`ProjectService.deploy`/`undeploy`, this commit).
  A "Deploy" action exposes **one workspace's one service** on a public URL,
  ByteXL's `bytexl.live` analogue. A provider-neutral `ServiceExposer` seam
  (`packages/lab-provider/src/types.ts`) is implemented by `PodProvider.expose`
  (a `deploy` Service + `-deploy` Ingress under the same gateway as the IDE) and
  delegated by `RoutingProvider`, so the LMS never learns which runtime answers.
  `deploy` validates ownership + `running`, persists `deployUrl`/`deployPort` on
  the workspace, and `stopWorkspace` clears them (a stop tears the namespace
  down). Routes: `POST`/`DELETE /api/projects/workspaces/:workspaceId/deploy`.
  **Multi-service apps stay N independent workspaces** (§1.4) — there is no
  composed multi-container deploy.
- **E5b = fork cost/quota policy** (ADR-20). A fork's compute is **suspended, not
  destroyed, on stop**: `ProjectService.stopWorkspace` calls the provider-neutral
  `Suspendable` seam when the provider offers it (`suspend`/`resume`), so the
  durable volume survives and re-forking resumes the same workspace. A provider
  without the seam is terminated as before. Forks are swept by the lab operator
  on their **own** idle/max-session limits (`findForksToStop`, 60-min idle / 8-h
  max, ADR-20), never the 30-min lab sweep. `tenants.maxStorageGb` (0 = unlimited)
  is a fork-only ceiling enforced at fork time (`checkStorageQuota` +
  `forkStorageGb`); a *new* fork over the ceiling is a `storage_exceeded` conflict
  (409), while re-attaching to or resuming an existing fork is never gated.
- **Nimbus git publish** (`github/git-publish.service.ts`). "Source Control"
  connects GitHub via the **OAuth device flow** (`GitHubClient`, `DeviceCodeGrant`)
  and stores the token **encrypted** with `SecretBox` on a `GitConnection` row;
  one-click publish pushes the workspace to the student's own repo through the
  provider-neutral `GitPublisher` seam (`LabProvider & GitPublisher`), reusing a
  repo if one exists. `GitPublish` records **every** attempt, success or failure,
  so a failed push is never silently dropped. DI: `GIT` (needs `GITHUB` +
  `SECRET_BOX`); browser routes proxy under `apps/web/src/app/api/git/**`, and
  `GitPublishControl` lives on each fork card.
- **Cost/quota** (Nimbus). `tenants.monthlyBudgetCents` (0 = unlimited) is the
  ceiling; `UsageService` (`labs/usage.service.ts`) rolls `costSession` up over
  the tenant's sessions for the current calendar month and `checkLaunch` enforces
  both the concurrency and budget gates before a lab starts. `GET /api/labs/usage`
  backs the Nimbus `UsageCard`. The pure math stays in `runtime-policy`; the
  service only supplies data, so the gate and the dashboard read one source.
- **Auto-evaluation** (`projects/quality-evaluation.service.ts`, ADR-13). The
  SonarQube-equivalent run: on demand or at submit, `QualityEvaluationService`
  reads the workspace's source through the provider-neutral `WorkspaceReader`
  seam (`PodProvider.readWorkspaceFiles` mounts the workspace volume into a
  short-lived Job) and scores it with the AI plane's in-house `quality.py` via
  `AiBridgeClient.scoreQuality` (`POST /v1/quality/score`). The latest result is
  cached on the workspace (`qualityScore`/`qualityReport`/`analyzedAt`), every
  run is appended to a `quality_evaluations` history, and a submission snapshots
  it (`autoScore`/`autoReport`/`autoEvaluatedAt`) so the trainer still sees it
  after the workspace is gone. Gated by `AI_PLANE_URL` (empty ⇒ analysis
  unavailable, not a crash); a reader/analyzer failure is recorded as a `failed`
  evaluation, never thrown. `analyze`/`history` are ownership-gated (a foreign
  workspace is a 404, never a cross-tenant read). Routes:
  `POST /api/projects/workspaces/:workspaceId/analyze` and
  `GET .../evaluations`; `AutoEvaluateControl` lives on each fork card.

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
- **A Nest controller is dead until it is listed in `AppModule.controllers`.**
  Importing the class is not enough; `DashboardController` shipped wired to the
  provider but *unregistered*, so `/api/dashboard` 404'd (and the dashboard page
  rendered empty) until it was added. The `e2e.*.test.ts` suite boots the real
  `AppModule`, so a route-level assertion there catches this — unit-testing the
  controller class directly does not.
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
  set the provider is `null`. A tier with no route fails loudly rather than
  silently no-op'ing.
- **With no execution plane, lab launch fails fast (503) instead of creating a
  `WARM` session that never reaches `ACTIVE`** — otherwise the launch button
  spins forever. The failure reason is `lab_unavailable` → `SERVICE_UNAVAILABLE`;
  the web `LabLaunchButton` explains it. The controller also maps the other
  reasons honestly: `lesson_not_found` → 404, `membership_required` → 403,
  `not_a_lab` → 400 (never a misleading 401). Project forks keep the older
  behaviour (a provider-less fork stays `provisioning`) because
  `e2e.projects.test.ts` encodes that contract deliberately.
- **A `lab`-kind lesson is only launchable if it has an `exerciseSlug`.** The
  catalog DTOs carry `launchable` (`kind === 'lab' && Boolean(exerciseSlug)`), so
  the Labs page disables the launch control and the lesson page explains the gap
  instead of letting the student hit a 400. Seeded demo labs always have a slug.
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
- **A user-defined Docker network defaults to MTU 1500 and ignores the daemon's
  `mtu` setting.** When the real path MTU is lower (the OpenHands sandbox host is
  1460/1450, because the outer network adds tunnelling overhead), small packets
  pass but full-size TLS records are silently dropped — GitHub downloads hang
  while npm works, which looks like an app bug. Piston installs its runtimes by
  fetching packages from GitHub at runtime, so it hung and wedged its API. The
  compose `default` network pins `com.docker.network.driver.mtu` (1450, or
  `DOCKER_NETWORK_MTU`) to match the daemon. Changing it requires recreating the
  network (`docker compose down` then up); an existing network keeps its old MTU.
- **Piston package names are not runtime aliases.** `POST /api/v2/packages` keys
  on the package (`node`, `gcc`, `mono`, `typescript`) while `GET /api/v2/runtimes`
  reports the language (`javascript`, `c`, `csharp`), so an idempotency check must
  map one to the other — installing an alias like `javascript` 404s. Re-installing
  an already-present package returns 500 `Already installed`, which `piston-init`
  treats as success.
