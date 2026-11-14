-- E4 auto-evaluation: the SonarQube-equivalent quality run (ADR-13). The AI
-- plane's explainable analyzer scores a workspace's source; the latest result is
-- cached on the workspace and every run is appended to a history table so a
-- trainer can see what the analyser said and when. A submission snapshots the
-- workspace's latest result into its own columns.

-- AlterTable
ALTER TABLE "project_workspaces" ADD COLUMN "qualityScore" INTEGER,
ADD COLUMN "qualityReport" TEXT,
ADD COLUMN "analyzedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "project_submissions" ADD COLUMN "autoScore" INTEGER,
ADD COLUMN "autoReport" TEXT,
ADD COLUMN "autoEvaluatedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "quality_evaluations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT,
    "componentId" TEXT,
    "workspaceId" TEXT NOT NULL,
    "score" INTEGER,
    "issueCount" INTEGER NOT NULL DEFAULT 0,
    "report" TEXT,
    "status" TEXT NOT NULL DEFAULT 'succeeded',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quality_evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "quality_evaluations_workspaceId_idx" ON "quality_evaluations"("workspaceId");
CREATE INDEX "quality_evaluations_tenantId_userId_idx" ON "quality_evaluations"("tenantId", "userId");
