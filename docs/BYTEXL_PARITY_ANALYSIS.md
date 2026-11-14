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
ports, all behind the `LabProvider` seam (ADR-8, adapter-only). **Phase E core
(E0–E4) has since shipped** — projects/`/nimbus` fork → build → stop → submit →
evaluate runs end to end (`e2e.projects.test.ts`, `project-submission.service.ts`)
and was verified live on minikube (tier-2 pod fork, then stop → resume).
**E5 (one-click hosting) has since shipped** — a Deploy action exposes a running
workspace's service on a public URL via the provider-neutral `ServiceExposer`
seam. **IDE git publish has since shipped** — a Source Control control connects
GitHub via OAuth device flow and pushes the workspace to the student's own
account (ADR-8, adapter-only), and **tenant cost/quota is now surfaced and
enforced** at lab launch. **Auto-evaluation has since shipped** — an `ai-bridge`
client reads the workspace's source through the provider's `WorkspaceReader`
seam and scores it with the AI plane's in-house `quality.py` (ADR-13); the score
is cached on the workspace, appended to a history table, and snapshotted onto the
submission the trainer evaluates. What remains for full Nimbus parity is
**per-fork stop-when-idle cost/quota policy (E5b) and the dashboard resume +
attendance widgets (E6)**; what remains for differentiation is the **AI tutor +
soft skills** (Phase F) and **contests / recruiter portal** (Phase G).

| ByteXL module | TenXLab equivalent | State |
|---|---|---|
| Editor (70+ langs, AI help, saved code) | `/editor` on Piston + CodeMirror 6 | Done (6 langs; AI help missing) |
| Labs (ungraded practice + hints) | `/labs` | Done |
| Assessments (proctored, auto-graded) | `/assessments` | Done (browser proctoring; SEB + video deferred) |
| Nimbus (build/host/evaluate projects) | `/nimbus` | **Core + hosting + git publish + auto-evaluation shipped** (E0–E5); fork cost/quota policy + attendance remain |
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

### 1.2 Submission flow (Nimbus Submissions video, `zdhNqMrC86w`)

Transcript supplied 2026-11-12. The flow, with the design-relevant facts:

- **Where it lives.** "Nimbus submissions" is an item in the **LMS left
  navigation** — submissions are an LMS surface, not part of the Nimbus IDE.
  Projects are *built* in Nimbus and *submitted* in the LMS.
- **What the student sees.** A list of projects to submit with their
  **submission deadlines**. "Once the submission deadline has passed, the
  project will be **automatically closed and cannot be submitted for
  evaluation**." → deadline gating is server-authoritative.
- **The submission form fields:** (1) **title** ("clear and catchy name"), (2)
  **description** ("concise and informative"), (3) **select Nimbus Workspace**
  from a **dropdown** ("choose the exact workspace where your project was
  created"), (4) **optional GitHub link** and **demo URL** ("if your demo link
  is hosted on `bytexl.live`, include it here").
- **Lifecycle coupling (important).** "Sometimes you might encounter an error
  during submission if the Nimbus workspace is **still active**. … close any
  tabs … wait for 1 to 2 minutes to let the **session close** … try submitting
  again." → **submission requires the workspace to be stopped**; the snapshot is
  taken from a *closed* workspace, and there is an explicit "session closing"
  wait.
- **Demo hosting domain.** Demos are hosted on `bytexl.live` — ByteXL has a
  dedicated demo-hosting domain that the submission form links to.

### 1.3 GitHub publish (Source Control video, `ahiet1Sj0zc`)

Transcript supplied 2026-11-12. This **resolves the git-backend question**:

- **Entry point.** From the projects menu: "launch a **new template**" or "pick
  one of your **existing workspaces**". The fork source is a template *or* an
  existing workspace — both are in-platform.
- **Git is workspace-local and student-initialised.** Inside the VS Code
  workspace, the student opens the **Source Control tab → initialize
  repository**, sets `user.name`/`user.email` (the UI shows the two `git config`
  commands to run in the terminal), and commits. → There is **no hosted git
  backend**; the repo is local to the workspace.
- **Publish is an OAuth device-flow push to the student's own GitHub.** "allow
  GitHub … this will give you a **code** … copy and continue … paste the
  password … authorize the access." → **GitHub OAuth device flow**, pushing to
  the *student's* account, with a **public/private** choice and an optional
  **rename**.
- **Ongoing sync.** Later commits use **commit + sync** to push to the same
  GitHub repo.

**Consequence.** ByteXL does **not** host git and does **not** fork via a git
remote. A "template" is an in-platform scaffold; a "fork" copies that scaffold
(or an existing workspace) into a new workspace; git is local to the workspace;
"publish" is an OAuth push to the student's GitHub. This is simpler than a
hosted-git design and removes a piece of infrastructure from our Phase E.

### 1.4 Full-stack & infra templates (React+Spring+Mongo `hmUNO5WG0N0`, Alpine/NOS `PCv4lKAaT8w`)

Transcripts supplied 2026-11-12. These answer **how multi-service workspaces are
structured** — the E5.1 risk.

**Multi-service = multiple independent workspaces, not one composed stack.**
The full-stack video builds the app as **two separate Nimbus workspaces**:
a Spring Boot + MongoDB workspace (the backend) and, started fresh, a **React
workspace** ("pick react as your front end… I'll call it spring-apis-launch").
There is **no single "MERN stack" workspace**. The two are wired together by the
student:

- The backend **exposes a public URL** ("this is a working URL which is exposed
  to the Internet") — so each workspace can be reached from outside.
- Because the front end and back end are **different workspaces → different
  origins**, the student must add **`@CrossOrigin`** on the controller (and
  `allowedHosts = true`) for browser CORS. The video stresses this as a required
  step.
- The React workspace installs its own dependencies ("let it install all the
  dependencies"); the Alpine template ships **Debian with nothing installed**,
  and the student `apt install`s what they need (`net-tools`, `inetutils`,
  `dnsutils`).

**Two template shapes, therefore:**

1. **Language/framework templates** — pre-installed, dependency-ready (Flask,
   Java, Spring Boot, Spring+Mongo, React). "Alpine" is the **bare base image**:
   Debian, no language, `apt` available.
2. **The "stack" is a recipe, not a template.** ByteXL's "SpringBoot + MongoDB +
   ReactJS" guide is *two workspaces connected by the student*, not one
   provisioned environment.

**Consequence for us.** Our E5.1 ("multi-service frontend+backend+DB") should
**not** build a composed multi-container workspace. The parity-faithful model is:
**one workspace = one service/image**, each independently provisioned and
independently exposed on its own URL, with the student wiring them together
(and owning the CORS story). That is *simpler* than a composed stack and maps
directly onto our existing `PodProvider`/vcluster per-session provisioning. It
also means "one-click deploy" (§1.1) exposes **one service**, consistent with
scoping hosting to single-service apps.

**Note on NOS.** The "Network Operating System" guide is not a special runtime:
it is the **Alpine (bare Debian) template + `apt install`** of network utils,
practised in the terminal. So Nimbus's infra story overlaps our tier-2/tier-3
labs but is delivered as an ordinary workspace, not a network simulator.

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

ByteXL's Nimbus feature set (from §1.1), mapped to us. **Phase E core shipped
2026-11-13** (E0–E4): the project domain, fork lifecycle, submission +
evaluation, and the `/nimbus` UI are live and verified end to end.

| Capability | Status | Gap |
|---|---|---|
| Cloud VS Code workspace (persistent) | **Done** | Forks provision tier-2 pod / tier-3 vcluster `code-server` through the `LabProvider` seam; re-fork resumes a stopped workspace. Durable-state retention policy is E5b |
| Framework template catalog (Flask/Java/Spring/Mongo/React/NOS) | **Done** | `projects/templates.ts`: `python-flask`, `java`, `spring-boot`, `spring-boot-mongodb`, `react`, `debian-base` (the "Alpine"/NOS bare image) |
| Fork a template **or own workspace** | **Done** | `ProjectComponent.templateSlug` (catalog) or `templateWorkspaceId` (fork-your-own, §1.3); one fork per (component, student) |
| Built-in Source Control → publish to GitHub | **Done** | GitHub OAuth **device flow** connects the student's account; one-click publish pushes the workspace and records every attempt (§1.3). No hosted git backend (ADR-8) |
| One-click backend deployment + live URL | **Done** | "Deploy" exposes the running workspace's service on a per-workspace `-deploy` ingress via the `ServiceExposer` seam (`PodProvider.expose`), reusing the shared gateway; `deployUrl` is the analogue of ByteXL's `bytexl.live` and is captured on the workspace (E5) |
| Submission form (title, description, workspace picker, links) | **Done** | `project-submission.service.ts` + `ProjectComponentCard`; one submission per component |
| Submission deadline + auto-close | **Done** | Server-authoritative `deadline_passed` gate (§1.2) |
| Stop-before-submit lifecycle rule | **Done** | Rejects while the fork is `running`/`provisioning` with ByteXL's "wait for the session to close" message (§1.2) |
| SonarQube-style auto-evaluation | **Done** | `QualityEvaluationService` + `AiBridgeClient` read the fork's files via the `WorkspaceReader` seam and score them with the AI plane's `quality.py` (`POST /v1/quality/score`, ADR-13). The score is cached on the workspace (`qualityScore`/`qualityReport`/`analyzedAt`), kept as a `quality_evaluations` history, snapshotted onto the submission (`autoScore`/`autoReport`/`autoEvaluatedAt`), and surfaced to the trainer |
| Submissions: workspace + GitHub URL + demo URL | **Done** | Optional GitHub/demo links captured |
| Trainer evaluation + score | **Done** | Role-gated `evaluate(id, {score, feedback})` |
| Mobile resume / "Up Next" dashboard | **Missing** | No dashboard resume widget (E6) |
| Fork cost/quota policy (stop-when-idle) | **Partial** | Tenant-level monthly budget now enforced at launch + shown in the Nimbus `UsageCard`; per-fork stop-when-idle/idle limit and the storage dimension remain (E5b, ADR-20) |

### 2.6 Runtime / scale

| Capability | Status | Gap |
|---|---|---|
| Tier router | **Done** | `packages/runtime-policy/tier-router.ts` |
| Warm pool planning + reconciler | **Done** | `runtime-policy/warm-pool.ts`, `services/lab-operator` (12 tests, real PG + k8s ports) |
| Quotas + budget warnings | **Done** | `runtime-policy/quota.ts`; enforced at lab launch by `UsageService.checkLaunch` (concurrency + monthly budget) |
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

- [x] **E0 — Domain + persistence.** Contracts (`Project`, `ProjectComponent`,
      `ProjectWorkspace`, `ProjectFork`, `ProjectSubmission`) in
      `packages/contracts`; port interfaces in `common/ports.ts`; in-memory +
      Prisma impls; Prisma models + migration `…_projects`; seed a demo project.
      Unit tests only. A project is a **container of components** — one
      technology slot each (§1.2/§1.4); a student forks each component and
      submits per component.
- [x] **E1 — Fork lifecycle.** `projects/project.service.ts` mirrors
      `LabLaunchService`: validate membership + published status, resolve the
      component's template (catalog slug or existing workspace, §1.3), create a
      `ProjectWorkspace` + `ProjectFork`, then provision through the injected
      `LabProvider` **asynchronously** — the caller polls `getForkStatus` until
      the workspace reports `running` and an `ideUrl`. Re-forking re-attaches to
      the existing workspace (unique per `(component, student)`); a failed
      provision is recorded as `failed`, never `stopped`. Gated by
      `PROJECTS_ENABLED` / `PROJECTS_TIER`. **Stop/resume is done** — re-forking a
      stopped workspace re-provisions it against the same id (verified live on
      minikube); the expiry policy that keeps forks out of the lab operator's
      idle sweep still lands with E5b.
- [x] **E2 — Template catalog + git publish.** A template registry with **two
      shapes** (§1.4): (a) language/framework templates, dependency-ready
      (Flask, Java, Spring Boot, Spring+Mongo, React); (b) a **bare base image**
      ("Alpine" = Debian, no language, `apt` available) for infra/network work.
      A `ProjectComponent` references a template by `templateSlug` (catalog) or
      `templateWorkspaceId` (an existing workspace, fork-your-own §1.3); the
      fork copies that scaffold into the new workspace. **No hosted git
      backend** (§1.3): git is workspace-local (student runs `git init`/`config`
      in the IDE), and **publish = GitHub OAuth device-flow push to the student's
      own account** (public/private + optional rename). Submission keeps
      GitHub/demo URLs as optional free-text links.
      → **Template catalog done** (`projects/templates.ts`, both shapes);
      **IDE git publish done** — `git-publish.service.ts` + `GitHubClient`
      device flow + `SecretBox`-encrypted token storage, surfaced as a Source
      Control control on each fork (`GitPublishControl`). Every attempt
      (success or failure) is recorded as a `GitPublish` row.
- [x] **E3 — Submission + evaluation.** Mirror ByteXL's form (§1.2): **title,
      description, workspace picker, optional GitHub link, optional demo URL** —
      one submission per component, so the picker lists the student's forks for
      the project's components. **Server-authoritative deadline** that
      auto-closes the project. Enforce the **stop-before-submit** rule:
      submission snapshots a *closed* workspace, so reject (or wait) while the
      fork is ACTIVE — the exact error ByteXL shows. Tenant-scoped
      `listSubmissions`; role-gated `evaluate(id, {score, feedback})`.
      Auto-quality via a new `ai-bridge` client calling the AI plane
      `POST /v1/quality/score` (no client exists today; add `AI_PLANE_URL` to
      `env.ts`). Quality gate: extend `quality.py` (**ADR-13**); no
      SonarQube/Semgrep, so the license gate stays permissive-only.
      → **Submission, deadline, stop-before-submit, and evaluate done**
      (`project-submission.service.ts`); **auto-quality done** — `AiBridgeClient`
      (`apps/api/src/ai/`) + `QualityEvaluationService` read the fork's files
      through the provider `WorkspaceReader` seam (`PodProvider.readWorkspaceFiles`
      mounts the workspace volume into a short-lived Job), score them via the AI
      plane, cache the result on the workspace, keep a `quality_evaluations`
      history, and snapshot it onto the submission. Trainer-facing HTTP endpoints
      are wired in `ProjectsController`.
- [x] **E4 — HTTP + web.** `ProjectsController`, `PROJECT` token, module factory,
      role gating matching existing checks; `env.ts` gains `PROJECTS_ENABLED`,
      `PROJECTS_TIER`, `AI_PLANE_URL`. Replace the `/nimbus` `SurfacePage`
      placeholder: student view (list → detail → Fork → IDE link → submit →
      feedback) and instructor view (create, attach templates, publish,
      evaluate). Proxy routes under `app/api/projects/**`. **Submissions live in
      the LMS nav** (§1.2), not inside the IDE.
      → **Done** — `/nimbus` is a real role-aware page (`PROJECTS_ENABLED` /
      `PROJECTS_TIER` wired; `AI_PLANE_URL` now consumed by E3's auto-quality).
- [x] **E5 — One-click hosting (separable).** **Done.** A "Deploy" action
      exposes **one workspace** (one service): `ProjectService.deploy` validates
      ownership + `running`, then the provider-neutral `ServiceExposer` seam
      (`PodProvider.expose`) applies a per-workspace `deploy` Service + `-deploy`
      Ingress reusing the shared gateway; the URL is persisted as
      `deployUrl`/`deployPort` and `stopWorkspace` clears it. `undeploy`
      withdraws the ingress. **Multi-service apps are N independent workspaces**
      wired by the student with their own URLs + CORS (§1.4) — **not** a composed
      multi-container workspace, so there is no E5.1 compose build to do.
- [ ] **E5b — Fork cost/quota policy (ADR-20).** Stop-when-idle forks: default
      tier-2, 60-min idle stop + snapshot, 8-h max session, 90-day retention;
      quotas on concurrency + storage + monthly budget. Reuse `checkQuota`
      (add `storage_exceeded`), `findIdleSessions` (separate limit table), and
      `costSession`; add a `persistent: true` mode to `PodProvider` (Deployment
      + PVC, scale 0/1).
      → **Tenant-level half done:** `tenants.monthlyBudgetCents` + `UsageService`
      roll up `costSession` over the tenant's sessions, `checkLaunch` enforces
      the concurrency + monthly-budget gates at lab launch, and `/api/labs/usage`
      + the Nimbus `UsageCard` surface the period spend and budget warning. What
      remains is the **per-fork** stop-when-idle/idle-limit policy and the storage
      dimension.
- [ ] **E6 — Dashboard resume + attendance + docs.** "Up Next"/"Resume Learning"
      widget (ByteXL's smarter dashboard) and **student attendance** (overall +
      session-level) — a new small model + student/instructor views, discovered
      from the Jan'26 video and absent from our backlog (§2.9). Plus
      README/AGENTS notes and parity checkboxes.
- [ ] Exit criterion (unchanged): instructor creates a project; student forks,
      builds, submits; trainer scores it.

**Decisions (confirmed 2026-11-12):**

1. **Git backend — resolved by §1.3.** No hosted git; forks copy an in-platform
   scaffold; publish is a GitHub OAuth device-flow push to the student's own
   account.
2. **Hosting — deferred to E5 (confirmed).** E0–E4 deliver the parity path
   (create → fork → build → submit → evaluate); hosting ships after and cannot
   block parity.
3. **Fork tier — tier-2 default, tier-3 opt-in (confirmed).** Recorded in ADR-20.
4. **Fork cost/quota — stop-when-idle (confirmed).** ADR-20: 60-min idle stop +
   snapshot, 8-h max session, 90-day retention, concurrency + storage + budget
   quotas.
5. **Deadline/auto-close — per-project, server-authoritative.** Confirmed by
   §1.2; the project closes automatically when its deadline passes.

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
