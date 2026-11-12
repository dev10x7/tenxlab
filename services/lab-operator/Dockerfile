# syntax=docker/dockerfile:1

# TenXLab warm-pool operator. Built from the monorepo root so workspace
# dependencies (@tenxlab/contracts, lab-provider) resolve:
#   docker build -f services/lab-operator/Dockerfile .

FROM node:22-slim AS builder
WORKDIR /app
ENV NODE_ENV=development
# Manifests first so the dependency layer is cached across source edits.
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/lab-provider/package.json packages/lab-provider/
COPY packages/runtime-policy/package.json packages/runtime-policy/
COPY apps/api/package.json apps/api/
COPY services/lab-operator/package.json services/lab-operator/
RUN npm ci
COPY tsconfig.base.json ./
COPY packages ./packages
COPY services/lab-operator ./services/lab-operator
RUN npm run build -w @tenxlab/contracts -w @tenxlab/lab-provider -w @tenxlab/runtime-policy \
 && npm run build -w @tenxlab/lab-operator

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
# node_modules carries the workspace symlinks, so the built packages come along.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/services/lab-operator/package.json ./services/lab-operator/package.json
COPY --from=builder /app/services/lab-operator/dist ./services/lab-operator/dist
CMD ["node", "services/lab-operator/dist/main.js"]
