# Solution Design & Engineering Backlog: TenXLab Enterprise EdTech Platform

**Status:** Living document — refreshed 2026-11-11 to match what shipped.
**Companion docs:** `ARCHITECTURE.md` (design + ADRs), `docs/BYTEXL_PARITY_ANALYSIS.md`
(the living parity plan and phase tracker), `AGENTS.md` (engineering notes).

> **Scope note.** An earlier revision of this document proposed building on
> **Frappe LMS** with a **KubeLab fork**. Both were superseded before
> implementation and this document has been updated accordingly:
>
> - **System of record is NestJS + Next.js + PostgreSQL**, not Frappe. It is
>   already built, tested, and running (`apps/api`, `apps/web`).
> - **KubeLab is used adapter-only** (`ADR-8`): we integrate through the
>   `LabProvider` seam and never fork it, which keeps KubeLab's AGPL out of our
>   product artifact. The execution plane is `packages/lab-provider` +
>   `services/lab-operator`.
>
> The *stories* below (lab launch, webhook grading, tier routing, AI tutor,
> contests) remain the right backlog. Only the implementation vehicle changed.
> Progress is tracked in `docs/BYTEXL_PARITY_ANALYSIS.md`; this document is the
> design intent behind it.

---

## 1. System Architecture & Integration Blueprint

### High-Level Architecture

TenXLab is composed of **three planes**, all built:

* **System of Record (`apps/api` NestJS + `apps/web` Next.js + PostgreSQL):**
  multi-tenant institutions, departments, batches, courses, lessons, the
  gradebook, and the recruiter surface. Persistence goes through repository
  ports (`apps/api/src/common/ports.ts`) with Prisma-backed and in-memory
  adapters, so tests run without a database.
* **Execution Plane (`packages/lab-provider` + `services/lab-operator` +
  KubeLab):** interactive coding, browser terminals, VS Code (`code-server`),
  and isolated `vcluster` labs, all behind the provider-neutral `LabProvider`
  seam (`ADR-8`, adapter-only).
* **AI & Assessment Plane (`services/ai`, FastAPI):** plagiarism, code-quality
  scoring, speech/soft-skills evaluation, and a signed-webhook emitter.

**Auth & SSO:** the LMS issues short-lived **RS256** JWTs, published at
`/.well-known/jwks.json`, so KubeLab and the AI plane verify without a shared
secret. Partner (college → TenXLab) sign-in is a separate **HS256** signed-token
redirect (`identity/partner-sso.service.ts`).

```text
+-----------------------------------------------------------------------+
|                TenXLab System of Record (apps/api + apps/web)         |
|  [Multi-Tenant Orgs]  [Batches & Gradebook]  [Recruiter Portal]       |
+-----------------------------------------------------------------------+
         | (1. Launch Lab w/ RS256 JWT)            ^ (4. Signed webhook)
         v                                         |
+-----------------------------------------------------------------------+
|                    API Gateway & Auth Middleware                      |
+-----------------------------------------------------------------------+
         |                                         |
         v                                         v
+---------------------------------+   +---------------------------------+
|  Execution Plane (adapter-only) |   |   AI & Assessment Plane         |
|  packages/lab-provider:         |   |   services/ai (FastAPI):        |
|  - tier_1: Piston (MIT)         |   |   - plagiarism (rename-invariant)|
|  - tier_2: single Pod (code-    |   |   - quality.py (in-house, ADR-13)|
|            server + terminal)   |   |   - speech / soft-skills         |
|  - tier_3: vcluster (K8s)       |   |   - webhook signer               |
|  services/lab-operator: warm    |   |                                 |
|  pool + idle sweep              |   |                                 |
+---------------------------------+   +---------------------------------+
         |
         v
+---------------------------------+
|  KubeLab (AGPL) — NOT forked;   |
|  reached only through the       |
|  LabProvider adapter (ADR-8)    |
+---------------------------------+
```

---

## 2. Core Integration Data Contracts

These are the real contracts, defined once in `packages/contracts` (zod) and
shared by every plane. Do not hand-roll copies.

### A. Lab Launch JWT Payload (LMS → execution plane)

Signed **RS256** by the LMS; verified against the LMS JWKS endpoint.

```json
{
  "iss": "tenxlms",
  "sub": "student_uuid_98765",
  "aud": "kubelab",
  "tenant_id": "college_abc_engineering",
  "membership_role": "student",
  "batch_id": "2027_cse_sec_a",
  "course_id": "k8s-fundamentals-101",
  "exercise_id": "create-simple-pod",
  "runtime_tier": "tier_3_vcluster",
  "session_id": "sess_...",
  "callback_url": "https://lms.example.com/api/webhooks/lab",
  "iat": 1794383940,
  "exp": 1794384000,
  "jti": "uuid"
}
```

Schema: `LabLaunchJwtPayload` in `packages/contracts/src/index.schemas.ts`.

### B. Completion Webhook Payload (execution plane → LMS)

HMAC-SHA256 signed; the header is `x-tenxlab-signature-256`
(`SIGNATURE_HEADER`). Handled idempotently by
`gradebook/gradebook-webhook.service.ts`.

```json
{
  "event": "exercise.completed",
  "event_id": "uuid",
  "student_id": "student_uuid_98765",
  "tenant_id": "college_abc_engineering",
  "batch_id": "2027_cse_sec_a",
  "exercise_id": "create-simple-pod",
  "session_id": "sess_...",
  "status": "PASSED",
  "score": 100,
  "execution_time_ms": 1420,
  "attempt_count": 2,
  "code_snapshot_url": "s3://edtech-submissions/98765/create-simple-pod.tar.gz",
  "timestamp": "2026-11-11T09:04:00Z"
}
```

Schema: `CompletionWebhook`. AI-plane events (plagiarism/quality/speech) share
the same signature scheme (`AiWebhook`).

---

## 3. Detailed Epics & Developer / AI Agent Stories

Each story carries its **current status** and points at the code that
implements it. The authoritative phase tracker is
`docs/BYTEXL_PARITY_ANALYSIS.md §4`.

### Epic 1: Multi-Tenant LMS & Execution-Plane Bridge

#### Story 1.1: Institutional Multi-Tenancy & Batch Hierarchy — **Done**
* **Goal:** isolate data across partner colleges, departments, and batches.
* **Delivered:** tenant/membership model in `apps/api/src/common/ports.ts`;
  batches, enrolment, and gradebook in `batches/batch.service.ts` with
  `/batches` and `/grading` pages; every read is tenant-scoped and role-gated.
* **Remaining:** a tenant budget ceiling exists (`monthlyBudgetCents`,
  enforced at launch); a per-tenant admin console for it is still UI work.

#### Story 1.2: Interactive Lab Lesson Type & JWT Launcher — **Done**
* **Goal:** embed an execution-plane exercise directly inside a course lesson.
* **Delivered:** `LessonRecord.type` (`interactive_lab`) with `exerciseSlug`,
  `runtimeTier`, and `maxScore`; `labs/lab-launch.service.ts` signs the RS256
  launch JWT and the web renders a launch button (`LabLaunchButton`). Verified
  live on minikube (tier-3 `vcluster` → code-server IDE).
* **Remaining:** predictive warm-pool scale-up before class (`runtime-policy/
  warm-pool.ts` plans it; the operator is reactive today).

#### Story 1.3: Asynchronous Gradebook Webhook Receiver — **Done**
* **Goal:** record scores automatically when the execution plane's check passes.
* **Delivered:** `POST /api/webhooks/lab`, HMAC-verified
  (`gradebook/gradebook-webhook.service.ts`); invalid signatures are rejected;
  duplicate deliveries are handled idempotently (event ledger + replay guard).

---

### Epic 2: Hybrid Multi-Runtime Orchestrator (adapter-only)

#### Story 2.1: Runtime Tier Router (tier 1 / 2 / 3) — **Done**
* **Goal:** avoid expensive `vcluster` provisioning for simple DSA exercises.
* **Delivered:** `packages/runtime-policy/tier-router.ts` routes by
  `runtime_tier`; providers in `packages/lab-provider`:
  `tier_1_microvm` → `piston.provider.ts` (MIT; Judge0 rejected — GPL-3.0,
  `ADR-12`), `tier_2_container` → `pod.provider.ts` (single Pod: code-server +
  terminal), `tier_3_vcluster` → KubeLab's default vcluster workflow.
  `routing.provider.ts` composes them; the API injects it as `PROVIDER`.
* **Remaining:** none for the router itself.

#### Story 2.2: Pre-Warmed Session Pool Controller — **Partial**
* **Goal:** remove cold-start spikes when a whole batch starts at once.
* **Delivered:** `runtime-policy/warm-pool.ts` (planning) + `services/lab-operator`
  (reconciler + idle sweep, real Postgres + k8s ports, 12 tests).
* **Remaining:** schedule-driven scale-up 15 minutes before a batch's live class
  (today the operator is reactive).

---

### Epic 3: AI-Native Code Tutor & Soft-Skills

#### Story 3.1: Context-Aware Socratic AI Code Assistant — **Missing**
* **Goal:** replace static hints with a tutor that reads workspace context and
  terminal errors without leaking the answer.
* **Planned:** a tutor endpoint on the AI plane with Socratic guardrails
  (root cause + guiding question, never copy-pasteable solution code), plus a
  VS Code sidebar (webview) inside the lab container.
* **Mode split (ByteXL editor walkthrough, `DF193RQOXSk`):** ByteXL's editor
  assistant explains the error *and* returns corrected, ready-to-run code
  side-by-side. The practice editor should match that via an **`assist` mode**;
  the guardrailed **`socratic` mode** is the only one reachable from a graded
  assessment. See `docs/BYTEXL_PARITY_ANALYSIS.md` §1.6.
* **Why it matters:** the highest-risk AI item; it is Phase F and the primary
  product differentiator. Guardrails need a red-team eval suite before launch.

#### Story 3.2: AI English & Mock-Interview Evaluator — **Partial**
* **Goal:** automated communication scoring inside the LMS.
* **Delivered:** `services/ai/app/speech.py` scores grammar, vocabulary, filler
  words, and technical accuracy, and emits a signed `speech.evaluated` webhook.
* **Remaining:** the browser audio-recording widget and persisting the score on
  the student profile.

---

### Epic 4: Competitive Contests, Proctoring & Recruiter Portal

#### Story 4.1: Real-Time Hackathon & Contest Leaderboard — **Missing**
* **Goal:** timed contests across batches with live ranking.
* **Planned:** contest lifecycle with `start_time`/`end_time` gating and a Redis
  sorted-set leaderboard updated by the completion webhook (rank by score,
  tie-break by fastest completion). Schema stub: `bestContestRank` on the
  Skill Passport.

#### Story 4.2: Browser Anti-Cheat & AST Plagiarism Scanner — **Partial**
* **Goal:** assessment integrity for graded exams and hiring tests.
* **Delivered:** browser signals in `ProctorGuard` (tab switch, copy/paste,
  fullscreen-exit, offline) with a risk score
  (`proctoring/proctoring.service.ts`); authoritative server exam timer with
  auto-submit; read-only stub regions enforced server-side
  (`assessments/read-only.ts`); rename-invariant plagiarism in
  `services/ai/app/plagiarism.py` (18 tests).
* **Remaining:** batch-scope async plagiarism on submission with side-by-side
  diff links and an > 85 % similarity flag; webcam video is deferred (`ADR-15`).

#### Story 4.3: Recruiter Talent Discovery Portal — **Missing**
* **Goal:** let hiring partners filter and shortlist job-ready students.
* **Planned:** a read-only `recruiter` role over an indexed Skill Passport
  aggregating verified lab badges, contest ranks, and communication scores;
  filter by institution, graduation year, and minimum scores; CSV export /
  interview invite. Role enum exists (`MembershipRole`); the `/resumes`
  surface is a placeholder.

---

### Cross-cutting capabilities

| Capability | Status | Where |
|---|---|---|
| Partner SSO (HS256 signed redirect) | **Done** | `identity/partner-sso.service.ts` — claims `sub, partnerId, iat, exp, jti, name`; `jti` replay guard; pre-onboarded vs JIT provisioning |
| Safe Exam Browser integration | **Deferred (ADR-17)** | `.seb` config generator exists; the v1 exam path is browser-level proctoring |
| Copyleft license gate | **Done** | `scripts/check-licenses.mjs` (permissive-only) |
| In-house code-quality analyzer | **Done (ADR-13)** | `services/ai/app/quality.py` — no SonarQube/Semgrep |
| Editor (multi-language, saved, STDIN) | **Done** | `/editor`, CodeMirror 6 (ADR-19), Piston tier-1 |
| Nimbus (build/host/evaluate projects) | **In progress** | Core + hosting + git publish + auto-evaluation shipped; per-fork cost policy + attendance remain (see §4) |

---

## 4. Delivery Sequence & Current Position

The four-phase plan below has been overtaken by the finer-grained phase tracker
in `docs/BYTEXL_PARITY_ANALYSIS.md §4` (Phases A–G). This is the mapping:

| Original phase | Maps to | Status |
|---|---|---|
| **Phase 1 (wks 1–3): Core LMS & Lab Bridge** (Stories 1.1–1.3) | Parity Phases A–C | **Shipped** — Postgres persistence, auth, batch/gradebook UI, lab launch + webhook grading, editor, assessments |
| **Phase 2 (wks 4–6): Compute Optimization** (Stories 2.1–2.2) | Parity Phase D | **Largely shipped** — tier router, tier-2 pod provider, warm-pool operator; predictive scale-up remains |
| **Phase 3 (wks 7–9): AI Differentiation** (Stories 3.1–3.2) | Parity Phases E–F | **In progress** — speech scoring done; Socratic tutor + audio widget pending |
| **Phase 4 (wks 10–12): Scale, Contests & Hiring** (Stories 4.1–4.3) | Parity Phase G | **Not started** — contests, batch plagiarism, recruiter portal |

### Current focus — finish Nimbus (ByteXL's project-building surface)

Nimbus is the ByteXL-equivalent project surface and the largest remaining
parity gap. Shipped so far: the project domain, fork lifecycle, submission +
trainer evaluation, the `/nimbus` UI, **one-click hosting** (E5), **git
publish** (GitHub device flow + encrypted token + publish history), **tenant
cost/quota** (`monthlyBudgetCents` + `UsageService.checkLaunch` + the
`UsageCard`), and **auto-evaluation** (the `ai-bridge` client + `quality.py`
score, cached on the workspace and snapshotted onto the submission). Remaining,
in order:

1. **Per-fork stop-when-idle cost policy** (E5b) — `persistent: true`
   `PodProvider` mode (Deployment + PVC, scale 0/1), a fork idle-limit table,
   snapshot-on-stop, and the storage dimension.
2. **Nimbus polish** — AI-generate project title/description, preview-before-
   publish, and submission-nav parity.
3. **Phase E6** — dashboard "Up Next"/"Resume Learning" widget, the Nimbus
   landing dashboard (workspaces + deployed apps + live projects), and student
   attendance (overall + session-level).
4. **Release-video delta (2026-11-14)** — from ByteXL's monthly release videos:
   an **exam start passcode** (E6b), **database workspaces + template
   categories** (E6c), a **visual AI Mentor** and **CEFR** soft-skills rubric
   (Phase F), and **university/batch ranks** + a **profile-completion tile**
   (Phase G). See `docs/BYTEXL_PARITY_ANALYSIS.md` §1.5/§2.10.

Then Phase F (Socratic tutor + soft skills) and Phase G (contests, anti-cheat,
recruiter portal).

---

## 5. Decisions

These were open questions in the original draft and are now resolved; see
`ARCHITECTURE.md` for the full ADR table.

1. **System of record — NestJS + Next.js (not Frappe).** Confirmed and built.
2. **KubeLab — adapter-only, no fork (`ADR-8`).** Keeps AGPL out of the
   product artifact; the `LabProvider` seam keeps the runtime replaceable.
3. **Tier-1 runner — Piston (`ADR-12`).** Judge0 rejected (GPL-3.0).
4. **Code-quality gating — in-house `quality.py` (`ADR-13`).** No
   SonarQube/Semgrep, so the license gate stays permissive-only.
5. **Editor widget — CodeMirror 6 (`ADR-19`).** Monaco deferred.
6. **Proctoring — browser-level for v1 (`ADR-15`, `ADR-17`).** Video and full
   Safe Exam Browser integration are post-v1.
7. **Single region for v1 (`ADR-18`).** Multi-region-ready, not multi-region.
