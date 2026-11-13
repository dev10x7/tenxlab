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
| `packages/lab-provider` | `LabProvider` + KubeLab adapter, tier-2 pod provider, tier router |
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

The warm-pool operator is also opt-in (`operator` profile). It needs a reachable
cluster — `KUBECONFIG` is mounted read-only — and keeps warm sandboxes ready so
a launch claims one instead of cold-starting:

```bash
KUBECONFIG=$HOME/.kube/config docker compose --profile operator up --build
```

Tear down with `docker compose down` (add `-v` to drop the Postgres volume).

### One-shot dev bring-up (minikube + KubeLab + IDE gateway)

When you need the **real lab execution plane** (KubeLab on minikube) rather than
just the compose services, use the startup script. It starts the Docker daemon,
minikube with the ingress addon, the KubeLab control plane, the IDE gateway, the
API (KubeLab + projects enabled) and the web client — and is idempotent:

```bash
scripts/dev-up.sh            # bring everything up
scripts/dev-up.sh --status   # report each component up/down
scripts/dev-smoke.sh         # end-to-end test (add --no-lab to skip the slow vcluster)
scripts/dev-down.sh          # stop app processes (--all also stops minikube + Docker)
```

It handles the fiddly parts for you: docker-group access via `sg docker`, minting
a ServiceAccount token so the tier-2 pod provider can reach the cluster, and
unsetting `KUBERNETES_SERVICE_HOST` so the API targets minikube. See the
"Startup scripts" section of `AGENTS.md` for the full list of gotchas it encodes.

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

#### Enable the Editor's Run button (Piston)

Code execution is off by default, so the Editor's Run button returns 503 until
a tier-1 pool is configured. Start Piston and install the runtimes the editor
offers, then run the API with it enabled:

```bash
docker compose --profile runner up -d piston
curl -s http://localhost:2000/api/v2/runtimes                       # inspect
for rt in 'python=3.10.0' 'javascript=18.15.0' 'java=15.0.2' \
          'c=10.2.0' 'c++=10.2.0' 'sqlite3=3.36.0'; do
  lang=${rt%%=*}; ver=${rt##*=}
  curl -s -X POST http://localhost:2000/api/v2/packages \
    -H 'content-type: application/json' \
    -d "{\"language\":\"$lang\",\"version\":\"$ver\"}"
done

cd apps/api
PISTON_ENABLED=true npm start
```

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

### Run tier-2 labs without KubeLab (pod provider)

`tier_2_container` lessons do not need KubeLab: the API routes them to
`PodProvider`, which creates a per-session namespace holding a code-server pod, a
service, and an ingress. Enable it with:

```bash
POD_PROVIDER_ENABLED=true \
CODE_SERVER_IMAGE=codercom/code-server:latest \
npm start
```

The API then needs the same cluster RBAC the operator uses — apply
`deploy/lab-operator/operator.yaml` and run the API under that service account,
or grant its credentials equivalent rights. Tier-1 (Editor) and tier-3 (KubeLab)
are independent: enabling one does not enable the others, and a launch for a
tier with no provider is recorded as a catalog-only session.

## Quality gates

```bash
npm run typecheck       # TypeScript across all workspaces
npm run test            # node:test across all workspaces
npm run license:check   # fails on denylisted copyleft licenses
cd services/ai && .venv/bin/python -m pytest -q
```

CI runs the same gates plus an SBOM denylist check (see `.github/workflows`).
