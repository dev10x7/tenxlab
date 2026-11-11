#!/bin/sh
# Entrypoint for the TenXLab API container.
#
# Applies pending Prisma migrations when a database is configured and a
# migrations directory is present, then hands off to the CMD. This keeps the
# container self-sufficient: `docker compose up` migrates and starts in one step.
set -e

if [ -n "$DATABASE_URL" ] && [ -d "apps/api/prisma/migrations" ]; then
  echo "[entrypoint] applying Prisma migrations..."
  npx prisma migrate deploy --schema apps/api/prisma/schema.prisma
  echo "[entrypoint] seeding the system of record (idempotent)..."
  node apps/api/dist/seed.js
fi

exec "$@"
