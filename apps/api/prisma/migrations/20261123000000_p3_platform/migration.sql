-- P3 platform tables: AI mock-interview sittings, the AI Mentor conversation
-- log, the reusable question bank, and the social graph (posts + follows). The
-- Skill Passport aggregate table already exists (skill_passports) and is now
-- populated by PassportService rather than left empty.

-- CreateTable
CREATE TABLE "interview_attempts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "promptId" TEXT NOT NULL,
    "promptTitle" TEXT NOT NULL,
    "transcript" TEXT NOT NULL,
    "communicationScore" INTEGER NOT NULL,
    "grammar" INTEGER NOT NULL,
    "vocabulary" INTEGER NOT NULL,
    "fillerWords" INTEGER NOT NULL,
    "technicalAccuracy" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interview_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mentor_messages" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "topic" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mentor_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_questions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "options" TEXT,
    "correct" TEXT,
    "maxScore" INTEGER NOT NULL DEFAULT 1,
    "tags" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_posts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_follows" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "followerId" TEXT NOT NULL,
    "followeeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_follows_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "interview_attempts_userId_createdAt_idx" ON "interview_attempts"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "interview_attempts_tenantId_idx" ON "interview_attempts"("tenantId");

-- CreateIndex
CREATE INDEX "mentor_messages_userId_createdAt_idx" ON "mentor_messages"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "bank_questions_tenantId_createdAt_idx" ON "bank_questions"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "social_posts_tenantId_createdAt_idx" ON "social_posts"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "social_posts_userId_idx" ON "social_posts"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "social_follows_followerId_followeeId_key" ON "social_follows"("followerId", "followeeId");

-- CreateIndex
CREATE INDEX "social_follows_tenantId_followerId_idx" ON "social_follows"("tenantId", "followerId");

-- CreateIndex
CREATE INDEX "social_follows_tenantId_followeeId_idx" ON "social_follows"("tenantId", "followeeId");
