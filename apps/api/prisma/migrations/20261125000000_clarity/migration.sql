-- Phase F Clarity (ByteXL parity §2.10): one row per scored English-practice
-- attempt, carrying the skill, the CEFR band, and the four sub-scores. A
-- student's level per skill is derived from these rows on read, so the band is
-- never stored twice.

-- CreateTable
CREATE TABLE "clarity_attempts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "taskTitle" TEXT NOT NULL,
    "skill" TEXT NOT NULL,
    "response" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "band" TEXT NOT NULL,
    "grammar" INTEGER NOT NULL,
    "vocabulary" INTEGER NOT NULL,
    "content" INTEGER NOT NULL,
    "fluency" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clarity_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "clarity_attempts_userId_createdAt_idx" ON "clarity_attempts"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "clarity_attempts_tenantId_idx" ON "clarity_attempts"("tenantId");
