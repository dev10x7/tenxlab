# ByteXL Parity Analysis & Delivery Plan

**Status:** analysis + plan, grounded in the current `tenxlab` codebase and in
ByteXL's public help centre (fetched 2026-11-11).

Sources reviewed:

- `TenXLab_Product_Overview.md` (original backlog)
- `ARCHITECTURE.md` (authoritative design)
- https://support.bytexl.app/ — Coding Abilities, Coding Tests, Project
  Evaluation & Submission, SafeExamBrowser Guide, Single Sign-On (Partner
  Integration), FAQs, Video Guides
- https://bytexl.ai/nimbus + the byteXL YouTube channel (product page and the
  video-guides index; transcripts were bot-blocked, so claims come from the
  product page and the guides index — see §1.1)

---

## 0. Executive summary

**ByteXL's public surface** is four student modules — **Editor, Labs,
Assessments, Nimbus** — plus three cross-cutting capabilities: proctored tests
(Safe Exam Browser, tab-switch and copy/paste detection, time limits, video
recording), partner SSO (a 60-second **HS256** signed-token redirect), and
project submission/evaluation with trainer scoring.

**TenXLab's backlog** (`TenXLab_Product_Overview.md`) targets the same four
modules and adds three differentiators: a **hybrid runtime** (tier-1 microVM /
tier-2 pod / tier-3 vcluster), a **warm pool** for class-time scale, and an **AI
plane** (Socratic tutor, speech/soft-skills scoring). It also names contests,
anti-cheat plagiarism, and a recruiter portal.

**Where we are (2026-11-11):** P0–P2 are shipped and were verified live against
KubeLab on minikube; **Phase D (runtime scale-out) is largely done** — tier
router, tier-2 pod provider, and a warm-pool operator with real Postgres + k8s
ports, all behind the `LabProvider` seam (ADR-8, adapter-only). What remains for
parity is the **Nimbus-equivalent projects** (Phase E); what remains for
differentiation is the **AI tutor + soft skills** (Phase F) and **contests /
recruiter portal** (Phase G).

| ByteXL module | TenXLab equivalent | State |
|---|---|---|
| Editor (70+ langs, AI help, saved code) | `/editor` on Piston + CodeMirror 6 | Done (6 langs; AI help missing) |
| Labs (ungraded practice + hints) | `/labs` | Done |
| Assessments (proctored, auto-graded) | `/assessments` | Done (browser proctoring; SEB + video deferred) |
| Nimbus (build/host/evaluate projects) | `/nimbus` | **Missing** (Phase E) |
| Partner SSO (HS256) | `identity/partner-sso.service.ts` | Done |
| Proctoring (tab/copy/time) | `proctoring/` + `ProctorGuard` | Done |
| Recruiter / hiring | `/resumes` (Skill Passport) | **Missing** (Phase G) |

The rest of this document is the detailed gap analysis (§1–§3) and the phased
plan (§4–§6).

---

## 1. What ByteXL actually is (from their own docs)

ByteXL's help centre describes four student-facing modules:

| Module | What it does | Notes from their docs |
|---|---|---|
| **Editor** | Practise C, C++, Java, Python, web (HTML/jQuery/Bootstrap) and databases (MySQL, Oracle, MongoDB) | 70+ languages; saves code for later; AI help for syntax errors and to unblock |
| **Labs** | Practice problems, ungraded | Hints available; attached to chapters |
| **Assessments** | Graded tests with proctoring and auto-grading | Coding + MCQ + fill-in-the-blank + descriptive; copy/paste disabled, video recording, tab-switch detection, time limits |
| **Nimbus** | Project building and hosting | A separate product (`nimbus.bytexl.ai`): cloud VS Code workspace, template catalog (Flask/Java/Spring Boot/Mongo/React), built-in GitHub publish, one-click backend deploy, fork own workspaces, auto-evaluation via **SonarQube** (see §1.1) |

Cross-cutting features their docs make explicit:

- **Read-only code sections in tests** — stub code annotated with
  `# start your solution` / `# end your solution` (and `//`, `--` variants);
  everything outside the markers is non-editable. *Only one editable section
  per exercise is supported.*
- **Safe Exam Browser (SEB)** — `.seb` file download is the entry point; kiosk
  mode, network filtering, quit password held by users with `test:edit`.
- **Partner SSO** — signed-token redirect; JWT signed **HS256**; 60-second
  expiry; partner sends `partnerId`, a shared signing secret, and the SSO
  endpoint; secret stays server-side.
- **STDIN in the editor** — input must be supplied before running.
- **Library policy** — Editor: no user-installed libraries; Nimbus: full
  dependency management.
- **Project submission** — student attaches workspace, GitHub URL, demo URL.
- **Student attendance** — overall + session-level attendance reports in the
  student portal (Jan'26 update; "available for select organisations"). This is
  **not in `TenXLab_Product_Overview.md`** and has **no equivalent in our repo**.
- **Reliability/ops** — DNS fallback advice, alternate load-balancer URL,
  email bounce handling.

### 1.1 Nimbus deep dive (product page + video guides, fetched 2026-11-12)

Nimbus is a **separate product with its own subdomain** (`nimbus.bytexl.ai`),
marketed as a "Project Building Platform" inside the byteXL suite (byteXL App /
Nimbus / vLabs / Levels / Clarity / Hiring / Hackathon / Builder). It is a
**self-hosted, cloud VS Code workspace**, not a feature of the LMS. Verbatim
claims from the product page:

- **Personal workspaces in seconds** — a student starts coding without setup.
- **"Projects in an online VS Code"** — an online Visual Studio Code
  environment to create projects.
- **No installs, no data loss** — no local software/compatibility issues; work
  is server-side.
- **Templates for real-world builds** — pick a template to start "enterprise
  applications or mobile apps".
- **Industry-standard evaluation** — "evaluated on tools like **SonarQube**".
- **Mobile resume** — "resume working wherever they want, including mobile
  phones".

The **Video Guides index** enumerates the stacks Nimbus actually supports, which
is the clearest signal of the template catalog:

| # | Guide | Implied template |
|---|---|---|
| 1 | Working with Python Flask | Python backend |
| 2 | Working with Java | Java |
| 3 | Working with Spring Boot | JVM backend |
| 4 | Spring Boot + MongoDB | backend + DB |
| 5 | SpringBoot + MongoDB + ReactJS | full-stack (MERN-like) |
| 6 | **How to publish the code to GitHub** | built-in **Source Control** tab → push to GitHub |
| 7 | **NOS** | Network Operating System / infra projects |
| 8 | **Nimbus Submissions** | the submission flow |

The **Jan'26 platform-updates video** ("Deploy Projects in 1 Click, Fork
Workspaces & Smarter Dashboard"; transcript supplied 2026-11-12) confirms the
newest capabilities:

- **One-click backend deployment** (0:12–0:31) — make projects live and publish
  applications instantly for a portfolio.
- **Student attendance reports** (0:32–0:45) — overall summary plus
  **session-level** detail, surfaced in the student portal. *Available for
  select organisations.*
- **Project forking** (0:46–1:00) — fork predefined templates **or your own
  workspaces** to experiment without starting from scratch.
- **Smarter student dashboard** (1:11–1:46) — **"Up Next for You"** (upcoming
  assessments, projects, quizzes) and **"Resume Learning"** (continue exactly
  where you left off, one click).

**What this means for us.** Nimbus ≈ *a persistent, forkable VS Code workspace
with a framework template catalog, built-in git (GitHub publish), one-click
hosting, and SonarQube-style auto-evaluation, feeding a multi-artifact
submission + trainer scoring flow.* Everything except hosting and the template
catalog maps onto primitives we already own: the `LabProvider` seam
(provisioning), the ports/repository pattern, the async-launch shape, and the
AI plane's `quality.py`. Two deliberate differences: ByteXL ships Nimbus as a
**separate product/subdomain**, whereas we fold it into one platform; and ByteXL
uses **SonarQube**, whereas we extend `quality.py` (ADR-13) to keep the license
gate permissive-only.

---

## 2. Gap analysis: ByteXL vs. current TenXLab

Legend: **Done** = implemented and tested in this repo · **Partial** = scaffold
or pure logic present, not wired end-to-end · **Missing** = not started.

> **Verified live 2026-11-11:** the P1 loop runs end to end against the real
> KubeLab backend on minikube — login → launch (`tier_3_vcluster`) → cold start
> WARM→ACTIVE → "Open your lab environment" → the code-server IDE boots in a
> real browser (Explorer + editor + terminal). The blocker was the gateway
> forwarding the browser's `Origin` verbatim, which made code-server hang the
> WebSocket handshake; fixed by rewriting `Origin` to the upstream ingress host
> (`deploy/kubelab/ide-gateway.mjs`, regression-tested). The web client must be
> reached at `/lab/<ingress-host>/` via the gateway, not the raw node-IP host.

### 2.1 Foundations

| Capability | TenXLab status | Evidence |
|---|---|---|
| Multi-tenant LMS API | **Done** | `apps/api` — tenancy, catalog, 37 tests |
| Shared contracts (JWT/webhooks/events) | **Done** | `packages/contracts`, zod |
| RS256 launch JWT + JWKS | **Done** | `/.well-known/jwks.json` |
| Partner HS256 SSO | **Done** | `identity/partner-sso.service.ts` + jti replay guard |
| Idempotent gradebook webhook | **Done** | `gradebook/gradebook-webhook.service.ts` |
| Batches, enrolment & gradebook UI | **Done** | `batches/batch.service.ts` + `/batches`, `/grading` pages; tenant-scoped, role-gated |
| Copyleft license gate | **Done** | `scripts/check-licenses.mjs` (175 pkgs, clean) |
| Next.js web client | **Partial** | ByteXL-style shell: role-aware sidebar (Dashboard/Learn/Catalog; Editor/Assessments/Nimbus; Labs+More), plus Lab launch, catalog, and course pages |

### 2.2 Editor (ByteXL "Editor")

| Capability | Status | Gap |
|---|---|---|
| Multi-language run/edit | **Done** | Curated catalog (`EDITOR_LANGUAGES`) over Piston; CodeMirror 6 (`/editor`) |
| 70+ langs | **Partial** | Six curated languages today; add entries as the pool grows |
| STDIN before run | **Done** | STDIN panel → `POST /api/editor/run` |
| Save/reopen practised code | **Done** | Per-user snippets, tenant-scoped (`code_snippets`) |
| AI syntax help / unblock | **Missing** | AI plane has no tutor endpoint |

### 2.3 Labs

| Capability | Status | Gap |
|---|---|---|
| Ungraded practice labs | **Done** | `/labs` lists `lab` lessons and launches a real environment; distinct from graded Assessments. |
| Hints | **Done** | `lesson.hint` on the catalog DTO, revealed by `HintReveal`. |

### 2.4 Assessments

| Capability | Status | Gap |
|---|---|---|
| Coding + MCQ + fill + descriptive auto-grading | **Done** | `apps/api/src/assessments/grader.ts`, 21 tests |
| Read-only stub sections | **Done** | `read-only.ts` — `parseSolutionRegion`/`checkSolutionRegion`/`checkSubmissionRegions` enforce in-file regions delimited by `#`/`//`/`--` `start your solution` … `end your solution` (one region per file), matching ByteXL; whole-file `checkReadOnly` remains for no-marker files. |
| Proctoring event ingest + risk score | **Done** | `proctoring/proctoring.service.ts` |
| SEB config generation | **Done** | `buildSebConfig` |
| Tab-switch / copy-paste / time limits | **Done** | Authoritative server timer (`assessments/exam-timer.ts`: deadline, auto-submit, grace) plus browser capture in `ProctorGuard` (blur/focus, copy/paste, fullscreen-exit, offline). Video/webcam (ADR-15) and full SEB (ADR-17) are **out of v1**. |
| `.seb` download entry point | **Deferred** | No route serving the `.seb` file — full SEB integration is post-v1 (ADR-17) |
| SEB quit password (test:edit gated) | **Deferred** | Post-v1 (ADR-17) |

### 2.5 Projects (ByteXL "Nimbus")

ByteXL's Nimbus feature set (from §1.1), mapped to us:

| Capability | Status | Gap |
|---|---|---|
| Cloud VS Code workspace (persistent) | **Partial** | Tier-2 pod / tier-3 vcluster already run `code-server`; no *project* workspace model or long-lived lifecycle |
| Framework template catalog (Flask/Java/Spring/Mongo/React/NOS) | **Missing** | No template registry or fork source |
| Fork a template **or own workspace** | **Missing** | — |
| Built-in Source Control → publish to GitHub | **Missing** | No git integration in the workspace; submission takes a GitHub URL as free text |
| One-click backend deployment + live URL | **Missing** | — |
| SonarQube-style auto-evaluation | **Partial** | AI plane `quality.py` is our analyzer — **decided (ADR-13): extend it, no SonarQube/Semgrep** |
| Submissions: workspace + GitHub URL + demo URL | **Missing** | — |
| Trainer evaluation + score | **Missing** | — |
| Mobile resume / "Up Next" dashboard | **Missing** | No dashboard resume widget |

### 2.6 Runtime / scale

| Capability | Status | Gap |
|---|---|---|
| Tier router | **Done** | `packages/runtime-policy/tier-router.ts` |
| Warm pool planning + reconciler | **Done** | `runtime-policy/warm-pool.ts`, `services/lab-operator` (12 tests, real PG + k8s ports) |
| Quotas + budget warnings | **Done** | `runtime-policy/quota.ts` |
| Idle termination | **Done** | `findIdleSessions` + operator sweep |
| Cost telemetry | **Done** | `runtime-policy/cost.ts` |
| Piston tier-1 worker | **Done** | `packages/lab-provider/src/piston.provider.ts` (`CodeExecutionProvider`, ADR-12); Judge0 rejected: GPL-3.0 |
| Tier-2 pod provider | **Done** | `packages/lab-provider/src/pod.provider.ts` (namespace + code-server pod + service + ingress) |
| Provider routing by tier | **Done** | `packages/lab-provider/src/routing.provider.ts`; API injects it as `PROVIDER` |
| Predictive scale-up before class | **Missing** | Operator is reactive only |

### 2.7 AI plane

| Capability | Status | Gap |
|---|---|---|
| Plagiarism (rename-invariant) | **Done** | `services/ai/app/plagiarism.py`, 18 tests |
| Code quality scoring | **Done** | `quality.py` |
| Speech/soft-skills | **Done** | `speech.py` |
| Webhook signer | **Done** | `webhooks.py` |
| Socratic tutor with anti-leak guardrails | **Missing** | Highest-risk AI item |
| VS Code sidebar integration | **Missing** | — |

### 2.8 Contests & hiring

| Capability | Status | Gap |
|---|---|---|
| Contest lifecycle + Redis leaderboard | **Missing** | — |
| Recruiter Skill Passport portal | **Missing** | — |

### 2.9 Attendance (found only in the Jan'26 video, not in our backlog)

| Capability | Status | Gap |
|---|---|---|
| Student attendance (overall + session-level) | **Missing** | No attendance model anywhere in the repo or `TenXLab_Product_Overview.md`; batches track enrolment, not presence |
| Instructor attendance view / export | **Missing** | — |

This is a genuine scope discovery: it is not in our product overview, so it was
never planned. It is small (an attendance record per student per session, plus
two views) but must be added to the backlog to reach parity. See Phase E6.

---

## 3. Where TenXLab deliberately differs

These are not gaps; they are choices to keep or revisit.

1. **No Frappe.** Node.js LMS avoids AGPL. Cost: we build the LMS features
   Frappe LMS gives for free (batches, gradebook UI, video lessons).
2. **KubeLab as the execution plane**, behind `LabProvider`, rather than a
   bespoke runner. Cost: KubeLab is vcluster-first and early-stage; tiers 1–2
   are ours to build. **Resolved 2026-11-11 (ADR-8): adapter-only, no fork.**
   KubeLab serves tier-3 unmodified; tier-1 (Piston) and tier-2 (pod) are
   separate `LabProvider` implementations beside it. The cost we accept is that
   tier-2 authors a lab in our format, not KubeLab's. Revisit at Phase E.
3. **Kubernetes-native labs** (vcluster, `kubectl`, `helm`) are a genuine
   differentiator ByteXL does not advertise. Worth leading with.
4. **Permissive-only dependencies** enforced in CI, vs. ByteXL's SonarQube.

### 3.1 Backlog items not yet surfaced in the product

The overview's Epics 4.x (contests, anti-cheat plagiarism, recruiter portal) and
the Editor's "AI help" have no user-facing entry point yet:

- **No contest surface.** There is no nav entry or route for hackathons/contests
  (`apps/web/src/lib/nav.ts` lists Editor/Labs/Assessments/Nimbus/Learn/Reports/
  Resumes only), and no `contests` module in `apps/api/src`. Phase G.
- **No recruiter portal.** `/resumes` is a `SurfacePage` placeholder; the Skill
  Passport aggregate it reads is Phase G.
- **Editor AI help** is absent (the AI plane has plagiarism/quality/speech but no
  tutor endpoint). Phase F.
- **Dead directory:** `apps/api/src/assessment/` is empty and unreferenced (the
  live module is `assessments/`). Safe to delete.

---

## 4. Plan

The plan below is sequenced so that every phase ends with something demonstrable
and the CI gates stay green. Effort is in engineer-weeks (ew) for one full-stack
engineer; adjust for team size.

### Phase A — Close the P1 loop (2 ew)

Make the existing pieces work end-to-end before adding surface.

- [x] Persist to Postgres: implement Prisma-backed adapters for the ports in
      `apps/api/src/common/ports.ts` (in-memory stays for tests).
- [x] Auth end-to-end: session cookie issued by `apps/api`, consumed by
      `apps/web` via the existing `/api/*` proxy routes.
- [ ] Partner SSO landing page in the web app (`?reason=` error handling already
      stubbed in `lms.ts`).
- [ ] Lab launch button → KubeLab `/launch?token=` verified against a real
      KubeLab instance in staging.
- [x] Batch & gradebook UI: create a batch, assign students, read the gradebook
      (`/batches`, `/grading`), backed by `batches/batch.service.ts`.
- [ ] Exit criterion: instructor creates a batch; student SSO-links, launches a
      lab, and a graded score lands in the gradebook, all against Postgres.

### Phase B — Editor + Labs (3 ew)

This is the largest parity gap and the most-used surface.

- [x] Editor service: run code through a `CodeExecutionProvider` (ADR-12) —
      a narrow request/response seam, not `LabProvider` (a run is not a
      session). `PistonProvider` is the only implementation.
- [x] Web editor: CodeMirror 6 (ADR-19), language picker, STDIN panel, run, save.
- [x] Code persistence: per-user snippets, reopenable (`code_snippets`).
- [x] Lab vs. assessment distinction: `lesson.kind` drives graded vs. practice
      UI, with hints on practice items (`HintReveal`).
- [x] Exit criterion: a student solves a DSA problem in-browser, with STDIN,
      and their code is still there tomorrow (per-user `code_snippets`).

### Phase C — Assessment hardening (3 ew)

ByteXL's proctoring is their moat on exams; this is where we must match.

- [x] Read-only **regions**: marker parser for `#`/`//`/`--`
      `start your solution` / `end your solution`; one editable region per
      exercise, matching ByteXL (`parseSolutionRegion`, `checkSubmissionRegions`).
- [x] Browser proctoring client: blur/focus (tab switch), copy/paste
      interception, fullscreen-exit, offline — feeding the existing
      `ProctorEvent` ingest via `ProctorGuard`. **This is the v1 exam path
      (ADR-17).**
- [x] Server-side timer: authoritative start/end, auto-submit at expiry
      (`assessments/exam-timer.ts`).
- [ ] Full SEB integration: **deferred past v1 (ADR-17)** — serving the `.seb`
      file, kiosk/network filtering, quit password. The `buildSebConfig`
      generator stays in the codebase.
- [ ] Video proctoring: **deferred past v1 (ADR-15)** — browser events only.
- [x] Exit criterion: a proctored exam runs in the browser with timers,
      read-only stubs, and a risk score visible to the instructor (verified
      end to end in `apps/api/src/e2e.p2.test.ts`).

### Phase D — Runtime scale-out (3 ew)

- [x] Implement the tier-1 backend (**Piston**, ADR-12) behind
      `CodeExecutionProvider`; wired to the Editor. Tier-1 is a
      request/response provider — not a KubeLab session — per ADR-8.
- [x] Implement the tier-2 pod provider behind `LabProvider` (namespace +
      code-server pod + service + ingress, no Helm, no nested control plane).
- [x] Keep KubeLab unmodified: tier-3 only, reached through `KubeLabAdapter`.
- [x] Route providers by tier via `RoutingProvider`; the API injects it as
      `PROVIDER` so a `tier_2_container` launch no longer needs KubeLab.
- [x] Wire `services/lab-operator` to real ports: `KubernetesClient` (provider),
      Postgres-backed session store + warm inventory; deploy as a Deployment
      (`deploy/lab-operator/operator.yaml`) or a CronJob (`RECONCILE_ONCE=1`).
- [ ] Route `tier_1_microvm` launches (Lab surface) through the same provider.
- [ ] Predictive scale-up: a batch's scheduled class time raises the pool target
      15 minutes ahead (reads the LMS schedule).
- [ ] Load test: 500 concurrent launches; tier-1 boot < 2 s; claim < 1.5 s.
- [ ] Exit criterion: the numbers above hold under load.

### Phase E — Projects / Nimbus equivalent (3–4 ew core, +1–3 hosting)

Built as a forkable, IDE-backed project workspace that **reuses the
`LabProvider` seam for provisioning** — no second execution plane. Deliver in
sub-milestones so each ends demonstrable and CI-green:

- [ ] **E0 — Domain + persistence.** Contracts (`Project`, `ProjectWorkspace`,
      `ProjectFork`, `ProjectSubmission`) in `packages/contracts`; port
      interfaces in `common/ports.ts`; in-memory + Prisma impls; Prisma models +
      migration `…_projects`; seed a demo project. Unit tests only.
- [ ] **E1 — Fork lifecycle.** `projects/project.service.ts` mirroring
      `LabLaunchService`: validate membership + published status, provision via
      injected `LabProvider` (tier-2 default, tier-3 opt-in), record a
      `ProjectFork`, return immediately; `getFork` polls. Forks **must not** land
      in `lab_sessions` (the operator's 30-min idle sweep would reap them) —
      separate table + separate expiry policy.
- [ ] **E2 — Template catalog + git publish.** A template registry (Flask, Java,
      Spring Boot, Spring+Mongo, Spring+Mongo+React, NOS — mirroring ByteXL's
      guides), seeded as `ProjectWorkspace.templateRef`; fork clones the template
      into the workspace's git repo. Built-in Source Control → **publish to
      GitHub** (ByteXL's guide #6) as an API action, not free-text submission.
- [ ] **E3 — Submission + evaluation.** `submit(forkId, {workspaceRef, githubUrl,
      demoUrl})`, tenant-scoped `listSubmissions`, role-gated `evaluate(id,
      {score, feedback})`. Auto-quality via a new `ai-bridge` client calling the
      AI plane `POST /v1/quality/score` (no client exists today; add
      `AI_BASE_URL` to `env.ts`). Quality gate: extend `quality.py` (**ADR-13**);
      no SonarQube/Semgrep, so the license gate stays permissive-only.
- [ ] **E4 — HTTP + web.** `ProjectsController`, `PROJECT` token, module factory,
      role gating matching existing checks; `env.ts` gains `PROJECTS_ENABLED`,
      `PROJECTS_TIER`, `AI_BASE_URL`. Replace the `/nimbus` `SurfacePage`
      placeholder: student view (list → detail → Fork → IDE link → submit →
      feedback) and instructor view (create, attach templates, publish,
      evaluate). Proxy routes under `app/api/projects/**`.
- [ ] **E5 — One-click hosting (separable).** A "Deploy" action exposes a fork
      via a per-fork ingress (reuse `PodProvider`'s namespace+ingress builders);
      `demoUrl` = that ingress. **Scope v1 to single-service apps**;
      multi-service frontend+backend+DB is E5.1. Can ship after parity.
- [ ] **E6 — Dashboard resume + attendance + docs.** "Up Next"/"Resume Learning"
      widget (ByteXL's smarter dashboard) and **student attendance** (overall +
      session-level) — a new small model + student/instructor views, discovered
      from the Jan'26 video and absent from our backlog (§2.9). Plus
      README/AGENTS notes and parity checkboxes.
- [ ] Exit criterion (unchanged): instructor creates a project; student forks,
      builds, submits; trainer scores it.

**Open decisions before E0:** (1) git backend for fork/template — recommend
self-hosted **Gitea** over GitHub template repos; (2) hosting in v1 or deferred
— recommend deferred (E5) so it cannot block parity; (3) fork tier — recommend
**tier-2 default, tier-3 opt-in**; (4) long-lived-fork cost/quota policy.

### Phase F — AI differentiation (3 ew)

- [ ] Socratic tutor endpoint with anti-leak guardrails (root cause + guiding
      question, never pasteable solution code) + a guardrail eval suite.
- [ ] VS Code sidebar client (webview) inside the lab container, streaming.
- [ ] Speech/soft-skills scoring wired to the web widget and the student
      profile.
- [ ] Plagiarism: run at batch scope on submission, flag > 85 % similarity with
      side-by-side diff links.
- [ ] Exit criterion: verified tutor guardrails (red-team prompts) and a
      communication score on the student profile.

### Phase G — Contests, anti-cheat, recruiter (3 ew)

- [ ] Contest lifecycle (`start_time`/`end_time` gating) + Redis sorted-set
      leaderboard updated from the completion webhook, < 500 ms.
- [ ] Skill Passport: indexed summary table aggregating verified labs, contest
      ranks, and AI communication scores.
- [ ] Recruiter role: read-only filters (institution, graduation year, min lab
      score, min communication score) + CSV export / interview invite.
- [ ] Exit criterion: a live contest with a real-time leaderboard and a
      recruiter shortlisting from the passport.

---

## 5. Suggested order and rationale

```
A (close P1)  →  B (editor/labs)  →  C (assessments)  →  D (scale)
              →  E (projects)     →  F (AI)           →  G (contests/hiring)
```

- **A first** because nothing else is trustworthy until data is durable and the
  SSO→launch→grade loop closes against a real database.
- **B before C** because assessments reuse the editor and the code sandbox; and
  the editor is the surface students touch most.
- **C before D** because proctoring is where ByteXL is strongest; parity on
  exams is a sales gate. D is about unit economics and can follow.
- **E is the biggest single build** and can start in parallel with C/D once the
  `LabProvider` abstraction is real, since Nimbus is essentially a persistent,
  forkable lab plus hosting.
- **F last among features** because the AI plane's pieces already exist; the
  remaining risk is the tutor's guardrails, which deserve focused effort rather
  than being spread thin.
- **G after E** because the recruiter portal reads the same aggregates E
  produces.

**Net:** parity with ByteXL by end of Phase E; differentiation (K8s labs, AI,
hiring) through F and G.

---

## 6. Decisions (resolved 2026-11-11)

All previously open items now have an owner decision. Recorded as ADRs in
`ARCHITECTURE.md` §4.

1. **SonarQube → extend in-house `quality.py` (ADR-13).** No SonarQube/Semgrep;
   keeps the product image permissive-only and the license gate clean.
2. **Tier-1 backend → Piston (ADR-12, amended 2026-11-11).** MIT, lighter than
   Judge0 (no Postgres/Redis), and a natural request/response fit. The original
   pick was Judge0, recorded as "Apache-2.0" — incorrect: Judge0 CE is GPL-3.0,
   which ADR-7 forbids. Editor widget is **CodeMirror 6** (ADR-19).
3. **Video proctoring → deferred past v1 (ADR-15).** Browser signals ship
   first; webcam recording/face-presence is a later phase.
4. **LLM strategy → hosted providers only (ADR-14).** OpenAI/Anthropic/Bedrock
   behind the provider abstraction; no self-hosted vLLM in v1.
5. ~~**KubeLab integration depth** — adapter-only vs. thin fork for native
   tier-2.~~ **Decided (ADR-8, 2026-11-11): adapter-only, no fork.** Revisit at
   Phase E if one exercise format across tiers outweighs a clean upstream.
   **Phase-E revisit (2026-11-12): still adapter-only.** Nimbus-style projects
   are *git-based, persistent workspaces* — the existing `LabProvider` seam
   provisions them without a KubeLab fork, and the template/fork/hosting
   concerns live entirely in our layer. A fork would buy nothing here, so ADR-8
   stands and the revisit trigger is closed.
6. **First segment → both (ADR-16).** Degree colleges and bootcamps from one
   platform, differentiated by plan/tenancy depth rather than a separate build.
7. **SEB depth → browser proctoring for v1 (ADR-17).** Full Safe Exam Browser
   integration (`.seb` delivery, kiosk, network filtering, quit password) is
   deferred; the `buildSebConfig` generator stays in the codebase.
8. **Data residency → single India region for v1 (ADR-18).** `ap-south-1` only;
   IaC stays region-parameterised so multi-region is a later addition.

All previously open decisions are now closed.
