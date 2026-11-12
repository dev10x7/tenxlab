# ByteXL Parity Analysis & Delivery Plan

**Status:** analysis + plan, grounded in the current `tenxlab` codebase and in
ByteXL's public help centre (fetched 2026-11-11).

Sources reviewed:

- `TenXLab_Product_Overview.md` (original backlog)
- `ARCHITECTURE.md` (authoritative design)
- https://support.bytexl.app/ — Coding Abilities, Coding Tests, Project
  Evaluation & Submission, SafeExamBrowser Guide, Single Sign-On (Partner
  Integration), FAQs, Video Guides

---

## 1. What ByteXL actually is (from their own docs)

ByteXL's help centre describes four student-facing modules:

| Module | What it does | Notes from their docs |
|---|---|---|
| **Editor** | Practise C, C++, Java, Python, web (HTML/jQuery/Bootstrap) and databases (MySQL, Oracle, MongoDB) | 70+ languages; saves code for later; AI help for syntax errors and to unblock |
| **Labs** | Practice problems, ungraded | Hints available; attached to chapters |
| **Assessments** | Graded tests with proctoring and auto-grading | Coding + MCQ + fill-in-the-blank + descriptive; copy/paste disabled, video recording, tab-switch detection, time limits |
| **Nimbus** | Project building and hosting | Backend/frontend/DB hosted in cloud; VS Code ecosystem; auto-evaluation via **SonarQube** |

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
- **Reliability/ops** — DNS fallback advice, alternate load-balancer URL,
  email bounce handling.

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
| Multi-language run/edit, 70+ langs | **Missing** | No editor surface at all yet |
| STDIN before run | **Missing** | — |
| Save/reopen practised code | **Missing** | — |
| AI syntax help / unblock | **Missing** | AI plane has no tutor endpoint |

### 2.3 Labs

| Capability | Status | Gap |
|---|---|---|
| Ungraded practice labs | **Partial** | Lab launch exists; no "lab" vs "assessment" distinction in UI |
| Hints | **Missing** | — |

### 2.4 Assessments

| Capability | Status | Gap |
|---|---|---|
| Coding + MCQ + fill + descriptive auto-grading | **Done** | `apps/api/src/assessments/grader.ts`, 21 tests |
| Read-only stub sections | **Done** | `read-only.ts` — `parseSolutionRegion`/`checkSolutionRegion`/`checkSubmissionRegions` enforce in-file regions delimited by `#`/`//`/`--` `start your solution` … `end your solution` (one region per file), matching ByteXL; whole-file `checkReadOnly` remains for no-marker files. |
| Proctoring event ingest + risk score | **Done** | `proctoring/proctoring.service.ts` |
| SEB config generation | **Done** | `buildSebConfig` |
| Tab-switch / copy-paste / time limits | **Partial** | Events + weights exist; authoritative server timer now in `assessments/exam-timer.ts` (deadline, auto-submit, grace). Browser event capture still to wire. Video/webcam (ADR-15) and full SEB (ADR-17) are **out of v1**. |
| `.seb` download entry point | **Deferred** | No route serving the `.seb` file — full SEB integration is post-v1 (ADR-17) |
| SEB quit password (test:edit gated) | **Deferred** | Post-v1 (ADR-17) |

### 2.5 Projects (ByteXL "Nimbus")

| Capability | Status | Gap |
|---|---|---|
| Cloud workspace with VS Code | **Missing** | Tier-3 vcluster is the substrate; no project workspace model |
| Template fork | **Missing** | — |
| Hosting (frontend/backend/DB) | **Missing** | — |
| SonarQube-style auto-evaluation | **Partial** | AI plane `quality.py` is our analyzer — **decided (ADR-13): extend it, no SonarQube/Semgrep** |
| Submissions: workspace + GitHub URL + demo URL | **Missing** | — |
| Trainer evaluation + score | **Missing** | — |

### 2.6 Runtime / scale

| Capability | Status | Gap |
|---|---|---|
| Tier router | **Done** | `packages/runtime-policy/tier-router.ts` |
| Warm pool planning + reconciler | **Done** | `runtime-policy/warm-pool.ts`, `services/lab-operator` (6 tests) |
| Quotas + budget warnings | **Done** | `runtime-policy/quota.ts` |
| Idle termination | **Done** | `findIdleSessions` + operator sweep |
| Cost telemetry | **Done** | `runtime-policy/cost.ts` |
| Judge0 tier-1 worker | **Missing** | Router targets the tier; the backend does not exist — **decided (ADR-12): Judge0** |
| Tier-2 pod provider | **Missing** | Same — targeted, not implemented |
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

---

## 3. Where TenXLab deliberately differs

These are not gaps; they are choices to keep or revisit.

1. **No Frappe.** Node.js LMS avoids AGPL. Cost: we build the LMS features
   Frappe LMS gives for free (batches, gradebook UI, video lessons).
2. **KubeLab as the execution plane**, behind `LabProvider`, rather than a
   bespoke runner. Cost: KubeLab is vcluster-first and early-stage; tiers 1–2
   are ours to build. **Resolved 2026-11-11 (ADR-8): adapter-only, no fork.**
   KubeLab serves tier-3 unmodified; tier-1 (Judge0) and tier-2 (pod) are
   separate `LabProvider` implementations beside it. The cost we accept is that
   tier-2 authors a lab in our format, not KubeLab's. Revisit at Phase E.
3. **Kubernetes-native labs** (vcluster, `kubectl`, `helm`) are a genuine
   differentiator ByteXL does not advertise. Worth leading with.
4. **Permissive-only dependencies** enforced in CI, vs. ByteXL's SonarQube.

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

- [ ] Editor service: wrap a code-run sandbox behind the `LabProvider`
      abstraction (a new `Judge0Provider` implementing the same interface).
- [ ] Web editor: Monaco, language picker, STDIN panel, run/format, save.
- [ ] Code persistence: per-user snippets, reopenable.
- [ ] Lab vs. assessment distinction: `lesson.kind` drives graded vs. practice
      UI, with hints on practice items.
- [ ] Exit criterion: a student solves a DSA problem in-browser, with STDIN,
      and their code is still there tomorrow.

### Phase C — Assessment hardening (3 ew)

ByteXL's proctoring is their moat on exams; this is where we must match.

- [x] Read-only **regions**: marker parser for `#`/`//`/`--`
      `start your solution` / `end your solution`; one editable region per
      exercise, matching ByteXL (`parseSolutionRegion`, `checkSubmissionRegions`).
- [ ] Browser proctoring client: `visibilitychange` (tab switch), copy/paste
      interception, fullscreen-exit, display-count — feeding the existing
      `ProctorEvent` ingest. **This is the v1 exam path (ADR-17).**
- [x] Server-side timer: authoritative start/end, auto-submit at expiry
      (`assessments/exam-timer.ts`).
- [ ] Full SEB integration: **deferred past v1 (ADR-17)** — serving the `.seb`
      file, kiosk/network filtering, quit password. The `buildSebConfig`
      generator stays in the codebase.
- [ ] Video proctoring: **deferred past v1 (ADR-15)** — browser events only.
- [ ] Exit criterion: a proctored exam runs in the browser with timers,
      read-only stubs, and a risk score visible to the instructor.

### Phase D — Runtime scale-out (3 ew)

- [ ] Implement the tier-1 backend (**Judge0**, ADR-12) behind
      `LabProvider`; wire the router's `tier_1_microvm` to it. Tier-1 is a
      request/response provider — not a KubeLab session — per ADR-8.
- [ ] Implement the tier-2 pod provider behind `LabProvider` (namespace +
      code-server pod + service + ingress, no Helm, no nested control plane).
- [ ] Keep KubeLab unmodified: tier-3 only, reached through `KubeLabAdapter`.
- [ ] Wire `services/lab-operator` to real ports: KubeLab provider + DB-backed
      session store; deploy as a CronJob.
- [ ] Predictive scale-up: a batch's scheduled class time raises the pool target
      15 minutes ahead (reads the LMS schedule).
- [ ] Load test: 500 concurrent launches; tier-1 boot < 2 s; claim < 1.5 s.
- [ ] Exit criterion: the numbers above hold under load.

### Phase E — Projects / Nimbus equivalent (4 ew)

- [ ] `Project` and `Workspace` domain objects; template workspace + fork.
- [ ] Hosting: deploy a forked workspace to a subdomain (tier-3 vcluster).
- [ ] Submissions: workspace link, GitHub URL, demo URL; trainer evaluation
      with a score.
- [ ] Quality gate: extend the in-house `quality.py` (**decided, ADR-13**); no
      SonarQube/Semgrep, so the license gate stays permissive-only.
- [ ] Exit criterion: instructor creates a project; student forks, builds,
      submits; trainer scores it.

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
2. **Tier-1 backend → Judge0 (ADR-12).** Mature, Apache-2.0, and a natural
   request/response fit; not Firecracker.
3. **Video proctoring → deferred past v1 (ADR-15).** Browser signals ship
   first; webcam recording/face-presence is a later phase.
4. **LLM strategy → hosted providers only (ADR-14).** OpenAI/Anthropic/Bedrock
   behind the provider abstraction; no self-hosted vLLM in v1.
5. ~~**KubeLab integration depth** — adapter-only vs. thin fork for native
   tier-2.~~ **Decided (ADR-8, 2026-11-11): adapter-only, no fork.** Revisit at
   Phase E if one exercise format across tiers outweighs a clean upstream.
6. **First segment → both (ADR-16).** Degree colleges and bootcamps from one
   platform, differentiated by plan/tenancy depth rather than a separate build.
7. **SEB depth → browser proctoring for v1 (ADR-17).** Full Safe Exam Browser
   integration (`.seb` delivery, kiosk, network filtering, quit password) is
   deferred; the `buildSebConfig` generator stays in the codebase.
8. **Data residency → single India region for v1 (ADR-18).** `ap-south-1` only;
   IaC stays region-parameterised so multi-region is a later addition.

All previously open decisions are now closed.
