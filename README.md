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
npm start                   # http://localhost:3000
```

The API serves its JWKS at `/.well-known/jwks.json`.

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

## Quality gates

```bash
npm run typecheck       # TypeScript across all workspaces
npm run test            # node:test across all workspaces
npm run license:check   # fails on denylisted copyleft licenses
cd services/ai && .venv/bin/python -m pytest -q
```

CI runs the same gates plus an SBOM denylist check (see `.github/workflows`).
