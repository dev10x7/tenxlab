# syntax=docker/dockerfile:1

# TenXLab web client (Next.js App Router). Built from the monorepo root.
#   docker build -f apps/web/Dockerfile .

FROM node:22-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/web ./apps/web
RUN npm run build -w @tenxlab/contracts \
 && npm run build -w @tenxlab/web

FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# node_modules (with the workspace symlinks) and the built app. The Next.js
# server renders on demand and proxies to the API, so both are needed at run time.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/web/package.json ./apps/web/package.json
COPY --from=builder /app/apps/web/.next ./apps/web/.next
COPY --from=builder /app/apps/web/next.config.mjs ./apps/web/next.config.mjs
EXPOSE 3000
WORKDIR /app/apps/web
CMD ["npx", "next", "start", "-p", "3000"]
