-- Warm-pool inventory for the lab execution plane.
--
-- The lab-operator boots sandboxes ahead of demand and records them here so a
-- student launch can claim a running sandbox instead of a cold start. A row is
-- deleted when the sandbox is claimed or reaped.

CREATE TABLE "warm_sandboxes" (
    "id" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "providerRef" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "warm_sandboxes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "warm_sandboxes_tier_idx" ON "warm_sandboxes"("tier");
