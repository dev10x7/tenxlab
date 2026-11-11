# Solution Design & Engineering Backlog: Frappe LMS + KubeLab Enterprise EdTech Platform

## 1. System Architecture & Integration Blueprint

### High-Level Architecture
* **System of Record (`Frappe LMS` + Custom Frappe App `edtech_core`):** Handles multi-tenant institutions, batches, courses, video/text lessons, gradebooks, and recruiter dashboards.
* **Execution Plane (`KubeLab` + `Hybrid Runtime Router`):** Handles interactive coding, browser terminals, VS Code, and isolated `vcluster` labs.
* **AI & Assessment Plane (`AI Tutor & Evaluator Service`):** A FastAPI microservice handling LLM-based Socratic code tutoring, anti-cheat similarity checks, and speech-to-text soft-skills scoring.
* **Auth & SSO (`Keycloak` or `Frappe OAuth2`):** Issues short-lived RS256-signed JWTs passed from Frappe LMS to KubeLab during lab launch.

```text
+-----------------------------------------------------------------------+
|                       Frappe LMS + edtech_core                        |
|  [Multi-Tenant Orgs]  [Batches & Gradebook]  [Recruiter Portal]       |
+-----------------------------------------------------------------------+
         | (1. Launch Lab w/ Signed JWT)            ^ (4. Webhook Score)
         v                                          |
+-----------------------------------------------------------------------+
|                     API Gateway & Auth Middleware                     |
+-----------------------------------------------------------------------+
         |                                          |
         v                                          v
+---------------------------------+   +---------------------------------+
|   KubeLab Hybrid Orchestrator   |   |   AI Tutor & Proctoring Svc     |
| - Tier 1: Judge0 / MicroVM (DSA)|   | - VS Code Sidecar Context       |
| - Tier 2: Single Pod (Web/DB)   |   | - Socratic LLM Guardrails       |
| - Tier 3: vcluster (Kubernetes) |   | - Whisper Soft-Skills Eval      |
+---------------------------------+   +---------------------------------+
```

---

## 2. Core Integration Data Contracts (For AI Coding Agents)

Provide these exact schemas to your AI coding agents when generating boilerplate across Frappe (Python) and KubeLab (Go/TypeScript).

### A. Lab Launch JWT Payload (`Frappe -> KubeLab`)
```json
{
  "iss": "frappe-lms",
  "sub": "student_uuid_98765",
  "tenant_id": "college_abc_engineering",
  "batch_id": "2027_cse_sec_a",
  "course_id": "k8s-fundamentals-101",
  "exercise_id": "create-simple-pod",
  "runtime_tier": "tier_3_vcluster",
  "callback_url": "https://lms.example.com/api/method/edtech_core.api.lab_webhook",
  "exp": 1794384000
}
```

### B. Completion Webhook Payload (`KubeLab -> Frappe`)
```json
{
  "event": "exercise.completed",
  "student_id": "student_uuid_98765",
  "tenant_id": "college_abc_engineering",
  "batch_id": "2027_cse_sec_a",
  "exercise_id": "create-simple-pod",
  "status": "PASSED",
  "score": 100,
  "execution_time_ms": 1420,
  "attempt_count": 2,
  "code_snapshot_url": "s3://edtech-submissions/98765/create-simple-pod.tar.gz",
  "signature": "hmac_sha256_hex_digest"
}
```

---

## 3. Detailed Epics & Developer / AI Agent Stories

### Epic 1: Multi-Tenant LMS & KubeLab Bridge (`edtech_core` Frappe App)

#### Story 1.1: Institutional Multi-Tenancy & Batch Hierarchy
* **Goal:** Extend Frappe LMS to isolate data across multiple partner colleges, departments, and graduation batches.
* **Implementation Details:** Create custom Frappe DocTypes (`Institution`, `Department`, `Academic Batch`) and apply Frappe User Permissions so college admins only view their own students.
* **Acceptance Criteria:**
  * [ ] `Institution` DocType created with fields: `institution_name`, `domain`, `max_concurrent_labs`, `status`.
  * [ ] `LMS Batch` linked to `Institution` and `Department`.
  * [ ] Role `College Admin` restricted via server-side permission query conditions to records matching their `Institution`.
* **AI Agent Prompt Hint:** *"Generate a Frappe custom DocType JSON and Python controller for `Institution` and add `permission_query_conditions` in `hooks.py` to isolate `LMS Batch` records by `institution`."*

#### Story 1.2: Custom "Interactive Lab" Lesson Type & JWT Launcher
* **Goal:** Allow instructors to embed a KubeLab exercise directly inside a Frappe LMS course chapter.
* **Implementation Details:** Extend `Course Lesson` in Frappe LMS with fields `lab_provider` (`KubeLab`), `exercise_slug`, `runtime_tier`, and `max_score`. Build a whitelisted Python endpoint `generate_lab_launch_url(lesson_name)` that signs an RS256 JWT and renders an embedded iframe or new tab launch button in the Vue.js frontend.
* **Acceptance Criteria:**
  * [ ] Instructor can select `Interactive Lab` when creating a lesson in Frappe LMS.
  * [ ] Clicking "Start Lab" fetches a signed JWT valid for 2 hours.
  * [ ] KubeLab verifies the RS256 public key and auto-authenticates the user without a second login screen.

#### Story 1.3: Asynchronous Gradebook Webhook Receiver
* **Goal:** Automatically record student scores in Frappe LMS when KubeLab's `Check` script passes.
* **Implementation Details:** Implement `@frappe.whitelist(allow_guest=True)` endpoint `edtech_core.api.lab_webhook`. Validate the `X-Hub-Signature-256` HMAC header, update `LMS Lesson Progress`, and trigger a realtime Socket.IO event to refresh the student's UI.
* **Acceptance Criteria:**
  * [ ] Invalid HMAC signatures return `HTTP 401`.
  * [ ] Valid `PASSED` payload marks the Frappe LMS lesson as `Complete` and logs `score` and `attempt_count`.
  * [ ] Duplicate webhook deliveries are handled idempotently.

---

### Epic 2: Hybrid Multi-Runtime Orchestrator (KubeLab Fork)

#### Story 2.1: Runtime Tier Router (`Tier 1`, `Tier 2`, `Tier 3`)
* **Goal:** Prevent expensive `vcluster` provisioning for simple Python/C++ DSA exercises while preserving full clusters for Kubernetes labs.
* **Implementation Details:** Modify KubeLab's session provisioning controller to read `runtime_tier` from the launch JWT:
  * `tier_1_microvm`: Route code execution to a lightweight **Judge0** or **Firecracker** worker pool.
  * `tier_2_container`: Provision a single isolated Kubernetes Pod (VS Code + terminal) without nested control-plane components.
  * `tier_3_vcluster`: Execute KubeLab's default `vcluster` provisioning workflow.
* **Acceptance Criteria:**
  * [ ] `tier_1` labs boot in `< 2 seconds` and consume `< 128MB RAM`.
  * [ ] `tier_3` labs provision an isolated `vcluster` with `kubectl` and `helm` pre-configured.
  * [ ] Idle sessions across all tiers automatically terminate after 30 minutes of inactivity.

#### Story 2.2: Pre-Warmed Session Pool Controller
* **Goal:** Eliminate cold-start bottlenecks when 500 students in a college batch start a lab simultaneously.
* **Implementation Details:** Build a Kubernetes operator/cron controller in Go that maintains a configurable buffer of `N` pre-initialized namespaces/vclusters (`status=WARM`) and claims them instantly upon JWT launch.
* **Acceptance Criteria:**
  * [ ] Pool scales up automatically 15 minutes before scheduled Frappe LMS batch live classes.
  * [ ] Claiming a warm session takes `< 1.5 seconds`.

---

### Epic 3: AI-Native Code Tutor & Soft-Skills (`Clarity` Clone)

#### Story 3.1: Context-Aware Socratic AI Code Assistant
* **Goal:** Replace static hints with an AI tutor that reads workspace files and terminal errors without leaking the final answer.
* **Implementation Details:** Build a lightweight FastAPI microservice (`/api/v1/tutor/hint`) and a minimal VS Code webview extension inside the KubeLab container. Capture the active file content, last 20 lines of terminal `stderr`, and the exercise's hidden `check.sh` rubric.
* **Acceptance Criteria:**
  * [ ] Clicking "Ask AI Tutor" in VS Code sends workspace context to the FastAPI service.
  * [ ] System prompt enforces Socratic guardrails (explains the root cause and asks a guiding question; never outputs copy-pasteable solution code).
  * [ ] Responses stream back to the VS Code sidebar in `< 3 seconds`.

#### Story 3.2: AI English & Mock Interview Evaluator
* **Goal:** Provide automated communication and interview readiness scoring inside Frappe LMS.
* **Implementation Details:** Build a Vue.js audio-recording widget in Frappe LMS that uploads WebM audio responses to FastAPI. Transcribe via `faster-whisper` and score grammar, vocabulary, filler words, and technical accuracy via an LLM structured-output schema.
* **Acceptance Criteria:**
  * [ ] Student completes a 3-question spoken prompt in the browser.
  * [ ] System stores a `0–100` communication score and actionable feedback report on the student's `LMS Student Profile`.

---

### Epic 4: Competitive Contests, Proctoring & Recruiter Portal

#### Story 4.1: Real-Time Hackathon & Contest Leaderboard
* **Goal:** Support timed coding contests and hackathons across batches.
* **Implementation Details:** Create a `Coding Contest` DocType in Frappe with `start_time`, `end_time`, and a list of KubeLab exercises. Use Redis Sorted Sets (`ZADD contest:{id}:leaderboard`) updated by the KubeLab webhook to rank students by total score and tie-break by fastest completion timestamp.
* **Acceptance Criteria:**
  * [ ] Students cannot launch contest labs before `start_time` or submit after `end_time`.
  * [ ] Leaderboard updates in real time (`< 500ms` latency) during active contests.

#### Story 4.2: Browser Anti-Cheat & AST Plagiarism Scanner
* **Goal:** Ensure assessment integrity during graded exams and hiring tests.
* **Implementation Details:**
  * **Frontend:** Add tab-visibility (`visibilitychange`) and clipboard-paste event listeners to the Frappe LMS lab wrapper, logging violations to a `Proctoring Log` DocType.
  * **Backend:** Trigger an asynchronous Python job upon exam completion that downloads `code_snapshot_url` archives and runs Tree-sitter AST token comparison across the batch.
* **Acceptance Criteria:**
  * [ ] More than 3 tab switches flags the submission for faculty review.
  * [ ] Submissions with `> 85%` structural AST similarity are flagged with side-by-side diff links.

#### Story 4.3: Recruiter Talent Discovery Portal
* **Goal:** Enable corporate hiring partners to filter and shortlist job-ready students based on verified lab and communication metrics.
* **Implementation Details:** Create a read-only `Recruiter` role and Vue.js dashboard in Frappe LMS querying an indexed summary table (`Student Skill Passport`) aggregating verified KubeLab badges, contest ranks, and AI communication scores.
* **Acceptance Criteria:**
  * [ ] Recruiters can filter candidates by `Institution`, `Graduation Year`, `Min KubeLab Score`, and `Min Communication Score`.
  * [ ] Clicking a candidate displays verified completed labs and allows one-click CSV export or interview invite trigger.

---

## 4. Recommended Implementation Sequence (4-Phase Roadmap)

1. **Phase 1 (Weeks 1–3): Core LMS & Lab Bridge** — Deploy `frappe/lms`, create `edtech_core`, and ship Stories **1.1, 1.2, and 1.3** (end-to-end SSO launch + webhook grading).
2. **Phase 2 (Weeks 4–6): Compute Optimization** — Implement Stories **2.1 and 2.2** so simple coding exercises run on lightweight containers while Kubernetes labs run on `vcluster`.
3. **Phase 3 (Weeks 7–9): AI Differentiation** — Deploy the FastAPI AI service and ship Stories **3.1 and 3.2** (Socratic VS Code tutor + spoken English evaluator).
4. **Phase 4 (Weeks 10–12): Scale, Contests & Hiring** — Ship Stories **4.1, 4.2, and 4.3** to unlock hackathons, proctored exams, and recruiter workflows.
