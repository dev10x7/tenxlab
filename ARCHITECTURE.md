# TenXLab — End-to-End Product Architecture

**Status:** Draft v1.0
**Owner:** TenXLab Engineering
**Last updated:** 2026-11-11
**Companion docs:** `TenXLab_Product_Overview.md`

---

## 1. Executive Summary

TenXLab is a multi-tenant, academic-integrated skilling platform for engineering
colleges. It competes with ByteXL on the same functional surface (LMS, coding
labs, assessments, cloud projects, proctoring, contests, campus hiring) while
differentiating on three axes:

1. **Real cloud-native labs** — isolated Kubernetes (`vcluster`) environments,
   not just hosted app workspaces.
2. **Cost-aware hybrid runtime** — a three-tier router that runs cheap exercises
   on microVMs and reserves full clusters for Kubernetes labs.
3. **AI-native pedagogy** — a Socratic tutor that refuses to leak answers, plus
   spoken-English / mock-interview scoring and a verified hiring "Skill Passport."

The product is composed of **three planes**:

| Plane | Responsibility | Primary Technology |
|---|---|---|
| **System of Record** | Institutions, courses, batches, gradebook, recruiter data | Node.js — NestJS + Next.js + PostgreSQL |
| **Execution Plane** | Lab provisioning, code execution, cloud workspaces | KubeLab on Kubernetes + vcluster |
| **AI & Assessment Plane** | Socratic tutoring, plagiarism, quality gating, soft-skills scoring | Python — FastAPI |

All three communicate over **signed JWTs** (launch) and **signed webhooks**
(completion), with **Redis** for real-time state and **S3-compatible storage**
for artifacts.

---

## 2. Scope

### 2.1 In scope
- Multi-tenant LMS (institutions, departments, batches, courses, lessons).
- Interactive coding labs and cloud project workspaces.
- Auto-graded assessments (coding + MCQ + fill-in-blank + descriptive).
- Proctoring (browser-level + Safe Exam Browser integration).
- Real-time contests and hackathons with leaderboards.
- AI tutor, soft-skills evaluator, plagiarism + code-quality gating.
- Recruiter talent-discovery portal.
- Partner SSO (college → TenXLab) and internal service SSO.
- Deployment, observability, and operational model.

### 2.2 Out of scope (v1)
- Mobile native apps (web is responsive; native is a later phase).
- Own LLM training/fine-tuning (we integrate providers).
- Payment/billing engine (assumed handled by a separate commercial system).
- On-premise/air-gapped deployment (SaaS-first; hybrid later).

---

## 3. Goals & Non-Goals

### 3.1 Goals
- **G1 — Parity + differentiation:** Match ByteXL's classroom workflow, beat it
  on real K8s labs, AI pedagogy, and hiring signals.
- **G2 — Multi-tenant isolation:** Hard tenant boundaries for colleges with
  shared infrastructure.
- **G3 — Elastic scale:** 500-student simultaneous lab launch without cold-start
  collapse.
- **G4 — License cleanliness:** Only permissive (MIT/BSD/Apache-2.0) dependencies
  in the product image. No AGPL/GPL.
- **G5 — Cost efficiency:** Runtime tiering keeps per-lab cost low.
- **G6 — Integrity:** Proctoring + plagiarism suitable for graded exams and
  hiring tests.

### 3.2 Non-goals
- Replacing a college's ERP/SIS (we integrate, not replace).
- Becoming a general-purpose cloud IDE for the public.
- Supporting every language/stack at launch (curated set first).

---

## 4. Key Decisions & Assumptions (ADR summary)

| # | Decision | Rationale | Status |
|---|---|---|---|
| ADR-1 | **Node.js stack: Next.js (web) + NestJS (API)** | Per user directive; permissive licenses; single language across LMS tier; large talent pool. | Accepted |
| ADR-2 | **Prisma + PostgreSQL** as ORM/DB | Apache-2.0 / permissive; type-safe; strong relational fit for LMS. | Accepted |
| ADR-3 | **KubeLab as execution plane** (as described in overview) | Per user directive; reuse existing lab-provisioning component. | Accepted (see ADR-8) |
| ADR-4 | **Python FastAPI for the AI plane** | Whisper, Tree-sitter, LLM SDKs are Python-native. | Accepted |
| ADR-5 | **Postgres Row-Level Security + `tenant_id`** for isolation | Scales better than schema-per-tenant; single migration path. | Accepted |
| ADR-6 | **RS256 JWTs** for internal service-to-service auth; **HS256** for partner SSO | RS256 lets KubeLab/AI verify without the signing secret; HS256 matches partner ergonomics. | Accepted |
| ADR-7 | **No AGPL/GPL dependencies** in product image | Avoids network-copyleft source-disclosure obligation. | Accepted |
| ADR-8 | **KubeLab integration behind a `LabProvider` interface** | There is no single canonical public "KubeLab" repo; the interface lets us swap/fork/build without touching LMS code. | Assumption |
| ADR-9 | **Redis Streams + BullMQ** for jobs/events (Kafka deferred) | Simplicity at current scale; revisit at >10k concurrent labs. | Accepted |
| ADR-10 | **S3-compatible object storage (S3/MinIO)** for snapshots | Portability; cost. | Accepted |

> **Assumption ADR-8 (explicit):** The `TenXLab_Product_Overview.md` refers to
> "KubeLab" as an existing lab-provisioning system (Go/TypeScript, vcluster-based).
> No single canonical public repository matches that description exactly. We
> therefore treat KubeLab as **a component we integrate with or fork**, defined
> strictly by the `LabProvider` interface in §8.4. If the intended KubeLab differs,
> only the adapter changes — not the platform.

---

## 5. Technology Stack

### 5.1 LMS / System of Record

| Layer | Technology | License |
|---|---|---|
| Web frontend | **Next.js (React) + TypeScript** | MIT |
| UI system | Tailwind CSS + shadcn/ui + Radix | MIT |
| Backend API | **NestJS + TypeScript** | MIT |
| ORM | **Prisma** | Apache-2.0 |
| Database | **PostgreSQL 16** | PostgreSQL |
| Cache / queue / pub-sub | **Redis 7** + **BullMQ** | BSD / MIT |
| Realtime | **Socket.IO** (NestJS gateway) | MIT |
| Auth | Passport + `@nestjs/jwt` (RS256), OAuth2/OIDC | MIT |
| Rich content editor | EditorJS (headings, images, embeds) | MIT |
| Code editor (light) | CodeMirror 6 (labs/assessments inline) | MIT |
| PDF/certificates | Puppeteer/Playwright render or WeasyPrint service | Apache-2.0 / BSD |

### 5.2 Execution Plane

| Layer | Technology | License |
|---|---|---|
| Orchestrator | **Kubernetes** (managed: EKS/GKE) | Apache-2.0 |
| Lab provisioning | **KubeLab** (per ADR-8) | TBD (verify) |
| Nested clusters | **vcluster** (Loft Labs) | Apache-2.0 (OSS core) |
| MicroVM execution | **Firecracker** and/or **Judge0** worker pool | Apache-2.0 |
| Warm-pool operator | Custom **Go** Kubernetes operator | ours |
| Workspace IDE | VS Code (code-server / OpenVSCode Server) | MIT |

### 5.3 AI & Assessment Plane

| Layer | Technology | License |
|---|---|---|
| Service framework | **FastAPI + Uvicorn** | MIT |
| LLM access | Provider abstraction (OpenAI/Anthropic/Bedrock/vLLM) | MIT (SDK) |
| Speech-to-text | **faster-whisper** | MIT |
| AST plagiarism | **Tree-sitter** parsers | MIT |
| Code quality gating | **SonarQube** (or Semgrep OSS) | LGPL* / LGPL* |
| Orchestration | Celery or Arq workers | BSD / MIT |

> \* **SonarQube/Semgrep caution:** SonarQube Community is LGPL-3.0 and Semgrep
> OSS is LGPL-2.1. Running them as **separate, unmodified services accessed over
> HTTP** is generally safe (LGPL's "mere aggregation" / network use), but they
> **must not be statically linked or embedded** in TenXLab binaries. If legal
> wants zero LGPL exposure, use a permissive static analyzer (e.g. custom
> Tree-sitter/ESLint/PMD rules). **Flag for legal review.**

### 5.4 Cross-cutting

| Concern | Technology | License |
|---|---|---|
| Object storage | S3 / MinIO | Apache-2.0 |
| Container runtime | Docker / containerd | Apache-2.0 |
| Ingress | NGINX Ingress + cert-manager | Apache-2.0 |
| Secrets | Vault or cloud KMS + External Secrets | MPL / Apache |
| Observability | OpenTelemetry + Prometheus + Grafana + Loki | Apache-2.0 / AGPL* |
| Tracing | Tempo or Jaeger | Apache-2.0 |
| CI/CD | GitHub Actions + Argo CD | MIT / Apache-2.0 |

> \* **Grafana is AGPL-3.0.** It is a **tool, not part of the product artifact**
> and is not linked into TenXLab code, so it does not trigger AGPL obligations
> on our source. Keep it in the ops toolchain, never bundled into the product.
> **Flag for legal review.**

### 5.5 License governance
- CI gate: `license-checker` (Node) + `pip-licenses` (Python) + SBOM (CycloneDX).
- **Denylist:** AGPL-3.0, GPL-2.0/3.0, SSPL, BSL (for product artifacts).
- **Allowlist:** MIT, BSD-2/3, Apache-2.0, ISC, PostgreSQL, MPL-2.0 (file-level).
- Every new dependency requires license review in PR.

---

## 6. System Architecture Overview

```text
                             ┌────────────────────────────────────────────┐
                             │        Clients (Browser / SEB)             │
                             │  Student · Instructor · College Admin ·    │
                             │  Recruiter · Platform Admin                │
                             └──────────────────────┬─────────────────────┘
                                                    │ HTTPS
                                                    ▼
                    ┌───────────────────────────────────────────────────────────┐
                    │                    Edge / API Gateway                     │
                    │   NGINX Ingress + WAF + Rate limiting + TLS (cert-manager) │
                    └───────┬───────────────────────────┬───────────────────────┘
                            │                           │
              ┌─────────────▼─────────────┐   ┌─────────▼──────────────────────┐
              │   LMS Web (Next.js)       │   │   Partner SSO callback         │
              │   SSR/CSR React app       │   │   /api/_callback/sso/partner   │
              └─────────────┬─────────────┘   └─────────┬──────────────────────┘
                            │ REST/GraphQL (httpOnly JWT cookie)
                            ▼
        ┌───────────────────────────────────────────────────────────────────────┐
        │                     LMS API  (NestJS)  — System of Record             │
        │  ┌───────────┬───────────┬───────────┬───────────┬─────────────────┐  │
        │  │ Identity  │ Catalog   │ Assessment│ Gradebook │ Recruiter       │  │
        │  │ & Tenancy │ Courses   │ Engine    │ Progress  │ Skill Passport  │  │
        │  └───────────┴───────────┴───────────┴───────────┴─────────────────┘  │
        │  Auth · RBAC · Prisma ORM · BullMQ · Socket.IO gateway                │
        └───────┬───────────────────────┬───────────────────────┬──────────────┘
                │                       │                       │
                │ (1) launch JWT        │ (5) signed webhook    │ (events)
                ▼                       │                       ▼
   ┌──────────────────────────┐        │            ┌───────────────────────────┐
   │  Execution Plane         │        │            │  AI & Assessment Plane    │
   │  KubeLab Orchestrator    │        │            │  FastAPI                  │
   │  ┌────────────────────┐  │        │            │  ┌─────────────────────┐  │
   │  │ Runtime Tier Router│  │        │            │  │ Socratic Tutor      │  │
   │  │ T1 microVM/Judge0  │  │        │            │  │ AST Plagiarism      │  │
   │  │ T2 single pod      │  │        │            │  │ Quality Gating      │  │
   │  │ T3 vcluster        │  │        │            │  │ Whisper Soft-skills │  │
   │  └────────────────────┘  │        │            │  └─────────────────────┘  │
   │  Warm Pool Operator (Go) │        │            │  LLM Provider Abstraction │
   └───────────┬──────────────┘        │            └─────────────┬─────────────┘
               │                       │                          │
               ▼                       ▼                          ▼
   ┌───────────────────────────────────────────────────────────────────────────┐
   │  Data & Messaging Layer                                                   │
   │  PostgreSQL (RLS)  ·  Redis (cache/streams/leaderboards)  ·  S3/MinIO      │
   │  OpenTelemetry → Prometheus/Grafana/Loki/Tempo                            │
   └───────────────────────────────────────────────────────────────────────────┘
```

**Primary flows:**
1. **Launch** — Student clicks "Start Lab" → LMS mints RS256 JWT → redirects to
   KubeLab → KubeLab verifies public key, claims a warm session, returns IDE URL.
2. **Learn** — Student works in VS Code; optional "Ask AI Tutor" calls AI plane
   with workspace context.
3. **Submit** — KubeLab `check.sh` runs → emits **signed completion webhook** to
   LMS → gradebook updated → Socket.IO pushes UI refresh.
4. **Evaluate** — Async jobs call AI plane for plagiarism/quality/soft-skills.
5. **Hire** — Recruiter queries the aggregated Skill Passport read model.

---

## 7. Domain Model

### 7.1 Tenancy & identity
- `Tenant` (Institution) — `id, name, domain, max_concurrent_labs, plan, status`
- `Department` — belongs to Tenant
- `AcademicBatch` — belongs to Department; `start, end, term`
- `User` — global identity; `email` unique
- `Membership` — links `User` ↔ `Tenant` with `role` (student, instructor,
  college_admin, recruiter, platform_admin)
- `Recruiter` — belongs to Tenant (hiring partner), read-only scope

### 7.2 Learning
- `Course` — belongs to Tenant; `title, description, status`
- `Module` (Chapter) → `Lesson` (`type`: video | text | pdf | **interactive_lab**)
- `LabLesson` — extends Lesson: `lab_provider, exercise_slug, runtime_tier, max_score`
- `Enrollment` — `User` ↔ `Course` within a Batch
- `LessonProgress` — `status, score, attempts, completed_at`
- `Certificate` — issued on completion; template reference

### 7.3 Assessment
- `Assessment` — `type`: coding | mcq | fill_blank | descriptive; `mode`: practice | graded
- `Question` — type-specific; coding questions carry `stub_code`, `readonly_markers`,
  `rubric_check_ref`, `hidden_tests_ref`
- `Attempt` — student attempt; `started_at, submitted_at, score, status`
- `Submission` — code snapshot ref, `code_snapshot_url`, `execution_time_ms`
- `ProctoringEvent` — `type` (tab_switch, paste, blur, seb_violation), `timestamp`

### 7.4 Contests & hiring
- `Contest` — `start_time, end_time, exercises[]`, `leaderboard_key`
- `ContestEntry` — `user, score, completed_at, rank`
- `SkillPassport` — read-model: verified badges, contest ranks, AI comm score
- `Project` → `ProjectWorkspace` → `ProjectSubmission` (`workspace_ref, github_url, demo_url`)

### 7.5 Execution (owned by KubeLab, mirrored in LMS)
- `LabSession` — `session_id, user, exercise, tier, status (WARM/ACTIVE/IDLE/TERMINATED),
  ide_url, started_at, last_activity_at, ttl`

---

## 8. Component Deep Dives

### 8.1 LMS Web — Next.js

- **Rendering:** App Router; SSR for public/marketing, CSR for authenticated
  app shell (dashboards, editor, gradebook).
- **Auth:** httpOnly, `SameSite=Lax`, Secure cookie holding the LMS access token;
  silent refresh via rotating refresh token. No tokens in `localStorage`.
- **State:** React Query (server state) + Zustand (UI state).
- **Role-based surfaces:** `/student`, `/instructor`, `/admin`, `/recruiter`.
- **Lab embed:** lab launch is a **redirect** (new tab/iframe) to the KubeLab IDE
  URL; the IDE is not rendered inside Next.js.
- **Realtime:** Socket.IO client for leaderboard, gradebook, and notification
  updates.
- **Accessibility & i18n:** WCAG 2.1 AA target; i18n framework for regional
  languages (Indian colleges).

### 8.2 LMS API — NestJS

Modular monolith (extract to services only when a module's scaling profile
diverges). Modules:

| Module | Responsibility |
|---|---|
| `identity` | Users, memberships, tenants, RBAC, SSO |
| `catalog` | Courses, modules, lessons, enrollment |
| `assessment` | Assessments, questions, attempts, grading orchestration |
| `gradebook` | Progress, scores, completion, certificates |
| `labs` | Lab launch (JWT mint), webhook receiver, session mirror |
| `contests` | Contest lifecycle, leaderboard integration |
| `proctoring` | Event ingestion, violation scoring, SEB config |
| `projects` | Project workspaces, submissions, evaluation |
| `recruiter` | Skill Passport queries, exports, interview invites |
| `notifications` | Email, in-app, realtime |
| `ai-bridge` | Client for AI plane (plagiarism, tutor, soft-skills) |

**Cross-cutting:** global exception filter, request-scoped tenant context,
Prisma middleware enforcing `tenant_id`, OpenTelemetry instrumentation,
idempotency keys on all webhook/ingest endpoints.

### 8.3 Auth & SSO

Two distinct flows:

**(a) Internal service auth — RS256**
- LMS holds the **private key**; exposes a JWKS endpoint with the **public key**.
- Launch JWT signed RS256; KubeLab and AI plane verify via JWKS (no shared secret).
- Claims (extends overview contract):

```json
{
  "iss": "tenxlms",
  "sub": "user_uuid",
  "tenant_id": "college_abc",
  "membership_role": "student",
  "batch_id": "2027_cse_a",
  "course_id": "k8s-101",
  "exercise_id": "create-simple-pod",
  "runtime_tier": "tier_3_vcluster",
  "session_id": "uuid",
  "callback_url": "https://lms.tenxlab.app/api/webhooks/lab",
  "iat": 1794384000,
  "exp": 1794391200,
  "jti": "uuid"
}
```
- Short TTL (2h), `jti` for replay protection, `aud`/`kid` headers set.

**(b) Partner SSO — HS256 (college → TenXLab)**
- Mirrors ByteXL ergonomics: signed-token redirect, 60s expiry, `jti` replay
  rejection, `partnerId`, JIT-provisioning option.
- Endpoint: `GET /api/_callback/sso/partner?token=<jwt>`.
- Error reasons: `invalid_signature`, `token_expired`, `replay_detected`,
  `unknown_partner`, `user_not_found`.
- Secrets stored in Vault/KMS; rotatable without code change.

### 8.4 Execution Plane — KubeLab (behind `LabProvider`)

**Interface (language-agnostic contract):**

```
LabProvider:
  provision(spec: LabSpec) -> SessionHandle
  getSession(sessionId) -> SessionStatus
  terminate(sessionId) -> void
  onCompletion(callback: WebhookHandler) -> void

LabSpec:
  exercise_id, runtime_tier, tenant_id, user_id,
  image/stack, resource_limits, ttl_seconds, network_policy
```

- KubeLab implements this; the LMS `labs` module depends only on the interface.
- **Network policy:** labs are egress-restricted by default (allowlist), critical
  for proctored exams and cost control.
- **Lifecycle:** `WARM → ACTIVE → IDLE → TERMINATED`; idle termination at 30 min
  (configurable per tenant/plan).

### 8.5 Runtime Tier Router

Reads `runtime_tier` from the launch JWT and routes provisioning:

| Tier | Use case | Runtime | Boot target | Memory |
|---|---|---|---|---|
| `tier_1_microvm` | DSA, single-file code | Firecracker microVM / Judge0 pool | < 2 s | < 128 MB |
| `tier_2_container` | Web/DB apps, VS Code + terminal | Single isolated Pod | < 10 s | ≤ 2 GB |
| `tier_3_vcluster` | Kubernetes/infra labs | vcluster (nested control plane) | < 60 s | ≤ 4 GB |

- Tier selection is **declared per exercise** but the router may **downgrade**
  (never silently upgrade) under capacity pressure, recording the decision.
- Per-tenant concurrency quotas enforced at claim time.

### 8.6 Pre-Warmed Session Pool

- **Go Kubernetes operator** maintains `N` pre-initialized sessions with
  `status=WARM` per tier per tenant class.
- **Predictive scaling:** reads the LMS class schedule; scales the pool up
  15 min before a scheduled batch session.
- **Claim latency target:** < 1.5 s.
- **Cost control:** pool size is bounded by `max_concurrent_labs` × plan tier;
  over-provisioning alerts fire when warm sessions idle > threshold.

### 8.7 AI & Assessment Plane — FastAPI

Independent service, scale horizontally, no direct DB access (talks to LMS via
API + Redis streams).

| Capability | Endpoint | Notes |
|---|---|---|
| Socratic tutor | `POST /v1/tutor/hint` | Inputs: active file, last 20 lines stderr, rubric. Output streamed. Guardrail: never emit copy-pasteable solution. |
| AST plagiarism | `POST /v1/plagiarism/scan` | Tree-sitter token/AST comparison across a batch; > 85% similarity flagged with diff links. |
| Quality gating | `POST /v1/quality/scan` | SonarQube/Semgrep run as external service; results normalized. |
| Soft-skills scoring | `POST /v1/speech/evaluate` | WebM audio → faster-whisper → structured LLM rubric (grammar, vocab, fillers, technical accuracy) → 0–100. |

- **LLM provider abstraction:** pluggable per tenant (cost, data residency,
  model choice). Prompt templates versioned.
- **Guardrails:** output filters to prevent solution leakage; token/rate limits;
  PII redaction before external LLM calls.
- **Async jobs:** plagiarism and quality scans run via Celery/Arq, results pushed
  back via signed webhook.

### 8.8 Real-Time & Contests

- **Leaderboards:** Redis Sorted Sets — `ZADD contest:{id}:leaderboard`.
  Tie-break by earliest completion timestamp (score, then time).
- **Contest window enforcement:** launch JWT rejected outside
  `[start_time, end_time]`; submissions after `end_time` rejected.
- **Latency target:** leaderboard updates < 500 ms via Socket.IO broadcast.
- **Anti-abuse:** per-user rate limits, server-authoritative scoring (client
  never computes final score).

### 8.9 Proctoring & Anti-Cheat

- **Browser-level:** `visibilitychange`, `blur`, clipboard/paste listeners,
  fullscreen enforcement; events → `ProctoringEvent`. > 3 tab switches flags for
  faculty review.
- **Webcam:** optional stream recording (MediaRecorder) → S3; face-presence
  checks (optional).
- **Safe Exam Browser (SEB):** generate `.seb` config per exam; kiosk mode,
  network filtering to allowlisted domains, quit password controlled by
  instructor. SEB launch detected and logged.
- **Code integrity:** read-only stub sections (annotated
  `// start your solution` … `// end your solution`) enforced server-side at
  grading; AST plagiarism post-submission.
- **Trust model:** all integrity signals are **server-authoritative**; client
  events are advisory evidence, never sole basis for auto-fail.

### 8.10 Recruiter Portal

- **Read model:** `SkillPassport` denormalized table, refreshed by events
  (badge earned, contest ranked, comm score updated).
- **Filters:** Institution, Graduation Year, Min Lab Score, Min Communication
  Score, verified badges.
- **Actions:** candidate detail (verified labs + evidence links), CSV export,
  interview invite trigger.
- **Access:** `Recruiter` role is read-only and tenant-scoped; all access logged
  for audit.

---

## 9. Integration Contracts

### 9.1 Lab Launch JWT (LMS → KubeLab)
See §8.3(a). Signed RS256; verified via JWKS; `exp` ≤ 2h; `jti` single-use.

### 9.2 Completion Webhook (KubeLab → LMS)

```json
{
  "event": "exercise.completed",
  "student_id": "user_uuid",
  "tenant_id": "college_abc",
  "batch_id": "2027_cse_a",
  "exercise_id": "create-simple-pod",
  "status": "PASSED",
  "score": 100,
  "execution_time_ms": 1420,
  "attempt_count": 2,
  "code_snapshot_url": "s3://tenxlab-submissions/.../create-simple-pod.tar.gz",
  "timestamp": "2026-11-11T09:00:00Z",
  "signature": "hmac_sha256_hex_digest"
}
```
- Header: `X-TenXLab-Signature-256`.
- **Idempotency:** dedupe on `(student_id, exercise_id, attempt_count)` + event id.
- Invalid HMAC → `401`. Unknown tenant → `422`.

### 9.3 AI plane webhooks (AI → LMS)
Same HMAC scheme; events: `plagiarism.scored`, `quality.scored`,
`speech.evaluated`, `tutor.session.ended`.

### 9.4 Event bus (internal)
Redis Streams topics: `lab.events`, `assessment.events`, `contest.events`,
`proctoring.events`, `ai.events`. Consumers are idempotent; at-least-once
delivery.

---

## 10. Multi-Tenancy

- **Model:** shared database, shared schema, **`tenant_id` on every row** +
  **PostgreSQL Row-Level Security (RLS)** policies.
- **Enforcement layers (defense in depth):**
  1. Request-scoped tenant context set from the authenticated JWT.
  2. Prisma middleware auto-injects `tenant_id` on reads/writes.
  3. Postgres RLS as the final backstop (even a raw query is scoped).
- **Cross-tenant data:** only `platform_admin` (break-glass, audited) and
  aggregated anonymized analytics.
- **Resource isolation:** per-tenant `max_concurrent_labs`, rate limits, and
  object-storage prefixes.
- **Why not schema-per-tenant:** migration/ops cost grows linearly; RLS + indexes
  scale better and keep one migration path. Revisit only if a tenant needs
  physical isolation (enterprise tier).

---

## 11. Data Storage & Flows

| Data | Store | Notes |
|---|---|---|
| Relational domain data | PostgreSQL | RLS, tenant_id, soft deletes |
| Sessions / cache / leaderboards | Redis | TTLs; sorted sets for contests |
| Code snapshots / recordings | S3/MinIO | Encrypted; lifecycle policies |
| Search (courses, candidates) | Postgres FTS → OpenSearch later | Start simple |
| Analytics / reporting | Postgres read replica → warehouse (later) | Batch ETL |
| Audit logs | Append-only table + object storage | Immutable, retention policy |

**Key write flows:** assessment submit (transactional), webhook grade update
(idempotent), contest score update (Redis + async Postgres persist),
proctoring event ingest (append-only, high volume → batched).

---

## 12. Security Architecture

- **AuthN:** OAuth2/OIDC + JWT (RS256 internal, HS256 partner). MFA for admins.
- **AuthZ:** RBAC (role) + ABAC (tenant, batch, ownership); enforced server-side.
- **Secrets:** Vault/KMS; no secrets in code, env files in repo, or client.
- **Transport:** TLS everywhere (cert-manager); mTLS optional between services.
- **Lab sandboxing:** network policies, resource limits, no host mounts, seccomp/
  gVisor where feasible, per-session isolation.
- **Data protection:** encryption at rest (DB, S3), PII minimization, redaction
  before LLM calls, data residency options per tenant.
- **Integrity:** HMAC-signed webhooks, JWT `jti` replay protection, server-side
  grading, immutable audit trail.
- **SDLC:** dependency license + CVE scanning in CI, SAST, signed images
  (cosign), SBOM per release.
- **Compliance posture:** GDPR/DPDP-ready (India DPDP Act), SOC 2 track later.
- **Threat model focus:** tenant cross-leak, lab escape, answer leakage via AI,
  proctoring bypass, webhook forgery/replay.

---

## 13. Observability & SRE

- **Tracing:** OpenTelemetry spans across LMS → KubeLab → AI for a lab launch
  and completion (end-to-end trace id propagated via JWT `trace_id`).
- **Metrics:** launch latency by tier, warm-pool hit rate, claim latency, idle
  terminations, webhook lag, AI p95 latency, leaderboard propagation.
- **Logs:** structured JSON → Loki; correlation by trace id.
- **Dashboards & alerts:** SLO-based (e.g. lab launch p95 < 3s; webhook
  processing p95 < 2s; leaderboard lag < 500ms).
- **Error budgets & on-call:** defined per SLO; runbooks for cold-start storms,
  Redis failover, pool exhaustion.

---

## 14. Deployment Topology & Environments

- **Environments:** `dev` → `staging` → `prod` (per-region).
- **Compute:** managed Kubernetes for execution plane; LMS/AI as containerized
  services (HPA on CPU/RPS + queue depth).
- **Regions:** start single-region (ap-south-1 for India colleges); design for
  multi-region later (data residency).
- **Data:** managed Postgres (Multi-AZ), Redis (HA), S3. Backups + PITR.
- **Release:** trunk-based, CI (test + license + SBOM gates), CD via Argo CD,
  blue/green or canary for LMS API.
- **IaC:** Terraform (cloud) + Helm/Kustomize (K8s). No manual prod changes.

---

## 15. Scalability & Performance Targets

| Metric | Target |
|---|---|
| Lab launch (warm claim) | < 1.5 s |
| Tier-1 cold boot | < 2 s |
| Tier-3 vcluster provision | < 60 s |
| Concurrent lab launches (peak) | 500 per batch event |
| Leaderboard propagation | < 500 ms |
| API p95 (non-lab) | < 300 ms |
| Tutor response (first token) | < 3 s |
| Webhook processing p95 | < 2 s |

**Scaling levers:** warm-pool depth, tier downgrade policy, HPA, read replicas,
Redis clustering, queue-based async for heavy AI jobs.

---

## 16. Delivery Roadmap

| Phase | Weeks | Deliverables | Exit criterion |
|---|---|---|---|
| **P0 — Foundations** | 0–1 | Repo, CI with license/SBOM gates, IaC, Postgres/Redis/S3, contracts frozen, KubeLab `LabProvider` spike | Environments up; contracts signed off |
| **P1 — Core LMS + SSO** | 2–4 | Tenancy, catalog, batches, partner SSO + internal RS256, lab launch + gradebook webhook | Admin provisions batch; student SSO-links, launches lab, grade lands |
| **P2 — Editor, Labs & Assessments** | 5–8 | Multi-language editor (STDIN, persistence), labs+hints, assessments (coding/MCQ/fill/descriptive), read-only stubs, proctoring + SEB | Proctored exam runs end-to-end |
| **P3 — Hybrid Runtime + Warm Pool** | 9–11 | Tier router, warm-pool operator, quotas, idle termination, cost telemetry | 500-student simultaneous launch, tier-1 < 2s |
| **P4 — Projects (Nimbus-equiv)** | 12–14 | Cloud workspaces, template fork, hosting, GitHub publish, submissions, trainer evaluation, quality gating | Instructor creates project; student forks/submits; trainer scores |
| **P5 — AI Differentiation** | 15–17 | Socratic tutor (anti-leak), speech/soft-skills scoring, plagiarism | Verified tutor guardrails + comm score live |
| **P6 — Contests, Anti-cheat, Recruiter** | 18–20 | Redis leaderboards, contest lifecycle, AST plagiarism, Skill Passport portal | Contest + recruiter flows live |

**Net:** ByteXL parity by ~P4 (week 14); differentiation (K8s labs, AI, hiring)
by ~P6 (week 20).

---

## 17. Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| KubeLab is not a single canonical product (ADR-8) | Schedule/technical | `LabProvider` interface isolates it; fork/build decision in P0 |
| Warm vcluster cost | Unit economics | Tier router, pool caps, predictive scaling, idle termination |
| AI answer leakage | Product credibility | Guardrail evals, output filters, red-team prompts |
| Tenant data cross-leak | Trust/legal | RLS + Prisma middleware + tests; pen-test |
| Proctoring weaker than SEB-based rivals | Win-rate on exams | Ship SEB integration in P2, not later |
| LGPL tooling (Sonar/Semgrep) exposure | Legal | Run as external service or replace with permissive analyzers |
| Grafana AGPL | Legal | Ops tool only; never bundled in product |
| Python/Node polyglot complexity | Velocity | Clear plane boundaries; contract tests between services |
| Cold-start storms at class time | UX/SLO | Predictive warm pool; downgrade policy; load tests |

---

## 18. Open Questions

1. **KubeLab:** fork the existing component, or build a thin orchestrator reusing
   its provisioning pieces? (P0 spike.)
2. **Code quality gating:** SonarQube/Semgrep (LGPL) vs. permissive custom rules —
   legal decision.
3. **LLM strategy:** hosted providers vs. self-hosted vLLM for cost/data
   residency?
4. **SEB depth:** full SEB integration vs. browser proctoring for v1?
5. **First segment:** degree colleges (full tenancy) or bootcamps (lighter)?
6. **Data residency:** single India region for v1, or multi-region from launch?

---

## Appendix A — Repository / Service Layout

```
tenxlab/
├─ apps/
│  ├─ web/            # Next.js (student, instructor, admin, recruiter)
│  └─ api/            # NestJS LMS API (modular monolith)
├─ services/
│  ├─ ai/             # FastAPI (tutor, plagiarism, quality, speech)
│  └─ warm-pool/      # Go Kubernetes operator
├─ platform/
│  ├─ helm/           # K8s manifests / charts
│  └─ terraform/      # Cloud IaC
├─ packages/
│  ├─ contracts/      # Shared types: JWT, webhooks, events
│  └─ ui/             # Shared React component library
├─ ARCHITECTURE.md    # This document
└─ docs/              # ADRs, runbooks
```

## Appendix B — Glossary

- **Plane** — a coarse architectural layer with its own tech/runtime.
- **Tier** — a runtime class for a lab (microVM / pod / vcluster).
- **Warm session** — a pre-initialized lab ready to claim instantly.
- **Skill Passport** — aggregated, verified student employability profile.
- **SEB** — Safe Exam Browser, an OS-level locked-down exam client.
