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

## Getting started

```bash
npm install
```

### Local infrastructure

```bash
docker compose up -d        # Postgres, Redis, MinIO
```

### Run the API

```bash
cd apps/api
npm run prisma:generate     # once
npm run build
npm start                   # http://localhost:4000
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

## Quality gates

```bash
npm run typecheck       # TypeScript across all workspaces
npm run test            # node:test across all workspaces
npm run license:check   # fails on denylisted copyleft licenses
cd services/ai && .venv/bin/python -m pytest -q
```

CI runs the same gates plus an SBOM denylist check (see `.github/workflows`).
