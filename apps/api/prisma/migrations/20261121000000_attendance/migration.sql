-- Attendance (E6c, ByteXL parity §2.9): a scheduled class meeting per batch,
-- and one attendance row per student per session. "Overall" attendance is the
-- aggregate over a student's sessions; the session-level view is the
-- per-meeting breakdown.

-- CreateTable
CREATE TABLE "class_sessions" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "class_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_records" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'absent',
    "markedBy" TEXT,
    "markedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "class_sessions_batchId_idx" ON "class_sessions"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_records_sessionId_userId_key" ON "attendance_records"("sessionId", "userId");

-- CreateIndex
CREATE INDEX "attendance_records_userId_idx" ON "attendance_records"("userId");

-- AddForeignKey
ALTER TABLE "class_sessions" ADD CONSTRAINT "class_sessions_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "academic_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "class_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
