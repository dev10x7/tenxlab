-- Support issues (ByteXL's "Report an Issue"): one row per user-submitted bug,
-- feature request, or question, with the page the reporter was on.

-- CreateTable
CREATE TABLE "support_issues" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "category" TEXT NOT NULL DEFAULT 'other',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "pageUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_issues_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "support_issues_tenantId_createdAt_idx" ON "support_issues"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "support_issues_userId_idx" ON "support_issues"("userId");
