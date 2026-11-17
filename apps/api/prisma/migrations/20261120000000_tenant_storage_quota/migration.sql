-- Cost & quota (ADR-20): a tenant's fork-storage ceiling, in gibibytes. 0 means
-- unlimited. Enforced when a project fork is created, alongside the monthly
-- budget enforced at lab launch.

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN "maxStorageGb" INTEGER NOT NULL DEFAULT 0;
