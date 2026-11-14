-- Cost & quota: a tenant's monthly spend ceiling, in USD cents. 0 means
-- unlimited. Enforced at lab launch and shown on the usage dashboard.

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN "monthlyBudgetCents" INTEGER NOT NULL DEFAULT 0;
