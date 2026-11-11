# TenXLab

Multi-tenant EdTech platform: an LMS (system of record) plus a Kubernetes
execution plane for hands-on labs.

- `ARCHITECTURE.md` — end-to-end design (authoritative).
- `AGENTS.md` — repository conventions and commands.

## Layout

| Path | What |
|---|---|
| `apps/web` | Next.js App Router client |
| `apps/api` | NestJS LMS API |
| `packages/contracts` | Shared zod schemas (launch JWT, webhooks, events) |
| `packages/lab-provider` | `LabProvider` interface + KubeLab adapter |
| `packages/runtime-policy` | Tier routing, warm-pool planning, quotas, cost |
| `services/ai` | FastAPI AI plane (plagiarism, quality, speech) |
| `services/lab-operator` | Warm-pool reconciler + idle sweeper |

## Prerequisites

- Node.js >= 22.6 (the web tests use `--experimental-strip-types`)
- Python 3.11+ (for `services/ai`)
- Docker with Compose v2 (for the full stack)

## Getting started

### Full stack (recommended)

```bash
docker compose up --build
```

This builds and starts everything, in dependency order:

| Service | URL | What |
|---|---|---|
| web | http://localhost:3000 | Next.js client |
| api | http://localhost:4000 | NestJS LMS API (applies migrations + seeds on boot) |
| ai | http://localhost:8000 | FastAPI AI plane (`/healthz`) |
| postgres | localhost:5432 | System of record (`tenxlab`/`tenxlab`) |
| redis | localhost:6379 | Cache / queue backing store |

The API container runs `prisma migrate deploy` and then seeds the demo tenant,
users, and course catalog (idempotent), so the stack is usable the moment it is
healthy. Sign in at http://localhost:3000/login with `student@tenxlab.local` /
`demo1234` (or `instructor@tenxlab.local` / `demo1234`).

Object storage (MinIO) is opt-in because it is not yet wired into the API:

```bash
docker compose --profile storage up --build
```

Tear down with `docker compose down` (add `-v` to drop the Postgres volume).

### Run the services individually

```bash
npm install
docker compose up -d postgres redis   # infra only
```

#### Run the API

```bash
cd apps/api
npm run prisma:generate     # once
npm run build
npm start                   # http://localhost:4000
```

With no `DATABASE_URL` the API uses an in-memory store seeded with the demo
catalog. To persist to Postgres (the system of record) set both:

```bash
DATABASE_URL=postgresql://tenxlab:tenxlab@localhost:5432/tenxlab \
USE_DATABASE=true npm start
```

The API serves its JWKS at `/.well-known/jwks.json`.

Seeded demo identities (local only): `student@tenxlab.local` / `demo1234`
and `instructor@tenxlab.local` / `demo1234`.

### Run the web app

```bash
cd apps/web
npm run dev                 # http://localhost:3000
```

Set `API_BASE_URL` if the API is not on `http://localhost:4000`.

### Run the AI plane

```bash
cd services/ai
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn app.main:app --port 8000
```

### Run the lab operator

```bash
cd services/lab-operator
npm run build
npm start
```

### Run labs against KubeLab (minikube)

The execution plane is the real KubeLab backend (`natrontech/kubelab`), reached
through a `LabProvider` adapter — no fork. To exercise a lab locally:

```bash
minikube start --cpus 4 --memory 8g
minikube addons enable ingress
kubectl apply -f deploy/kubelab/kubelab.yaml        # KubeLab control plane
kubectl port-forward -n kubelab svc/kubelab-service 8090:8090 &
```

Create the KubeLab admin the API authenticates as (once), via the PocketBase
admin API at `http://localhost:8090/_/`, using an email/password that matches
`KUBELAB_ADMIN_EMAIL` / `KUBELAB_ADMIN_PASSWORD` below.

Then run the API with KubeLab enabled. `LAB_ASSET_BASE_URL` is the address the
in-cluster agent uses to fetch bootstrap/check scripts, so it must be reachable
from inside the cluster (`host.minikube.internal` on minikube):

```bash
cd apps/api
KUBELAB_ENABLED=true \
KUBELAB_BASE_URL=http://localhost:8090 \
KUBELAB_ADMIN_EMAIL=tenxlab@tenxlab.local \
KUBELAB_ADMIN_PASSWORD=tenxlab-dev-admin \
KUBELAB_ALLOWED_HOSTS=192.168.49.2.nip.io \
LAB_ASSET_BASE_URL=http://host.minikube.internal:4000 \
npm start
```

A vcluster cold start takes one to several minutes, so `POST /api/labs/launch`
returns immediately with a session id and the UI polls
`GET /api/labs/sessions/:id` until the session is `ACTIVE` with an `ideUrl`.

The IDE is served on per-session ingress hostnames that resolve to the cluster
node IP. A browser that can route to that IP opens the ingress URL directly. If
it cannot (e.g. a remote browser reaching a local minikube), run the gateway
that fronts those hosts on one public port:

```bash
IDE_PROXY_PORT=12001 node deploy/kubelab/ide-gateway.mjs &
```

and point the API at it so emitted IDE URLs route through the gateway:

```bash
KUBELAB_IDE_PUBLIC_URL=http://localhost:12001 npm start
```

The gateway maps `/<gateway>/lab/<ingress-host>/...` to
`https://<ingress-host>/...`; readiness still probes the ingress directly.

## Quality gates

```bash
npm run typecheck       # TypeScript across all workspaces
npm run test            # node:test across all workspaces
npm run license:check   # fails on denylisted copyleft licenses
cd services/ai && .venv/bin/python -m pytest -q
```

CI runs the same gates plus an SBOM denylist check (see `.github/workflows`).
