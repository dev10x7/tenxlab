-- Phase G contests (ByteXL parity §2.8): a timed contest and one row per
-- (contest, student) holding that student's best score. The live leaderboard is
-- served from a Redis sorted set; these rows are the durable source of truth it
-- is rebuilt from.

-- CreateTable
CREATE TABLE "contests" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "maxScore" INTEGER NOT NULL DEFAULT 100,
    "exerciseSlug" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contest_entries" (
    "id" TEXT NOT NULL,
    "contestId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "score" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contest_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contests_tenantId_createdAt_idx" ON "contests"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "contest_entries_contestId_userId_key" ON "contest_entries"("contestId", "userId");

-- CreateIndex
CREATE INDEX "contest_entries_contestId_score_idx" ON "contest_entries"("contestId", "score");

-- CreateIndex
CREATE INDEX "contest_entries_userId_idx" ON "contest_entries"("userId");

-- AddForeignKey
ALTER TABLE "contest_entries" ADD CONSTRAINT "contest_entries_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "contests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
