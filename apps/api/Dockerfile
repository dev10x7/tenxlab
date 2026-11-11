# syntax=docker/dockerfile:1

# TenXLab LMS API (NestJS). Built from the monorepo root so workspace
# dependencies (@tenxlab/contracts, lab-provider, runtime-policy) resolve.
# Build context is the repository root:
#   docker build -f apps/api/Dockerfile .

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
# Sources.
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
COPY services/lab-operator ./services/lab-operator
COPY scripts ./scripts
RUN npm run build -w @tenxlab/contracts -w @tenxlab/lab-provider -w @tenxlab/runtime-policy \
 && npx prisma generate --schema apps/api/prisma/schema.prisma \
 && npm run build -w @tenxlab/api

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
# node_modules carries the generated Prisma client and workspace symlinks, so
# the built packages must come along for those links to resolve.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/prisma ./apps/api/prisma
COPY apps/api/docker-entrypoint.sh ./apps/api/docker-entrypoint.sh
RUN chmod +x ./apps/api/docker-entrypoint.sh
EXPOSE 4000
ENTRYPOINT ["./apps/api/docker-entrypoint.sh"]
CMD ["node", "apps/api/dist/main.js"]
