-- Course & lesson authoring (Phase H1). Courses gain a URL-safe slug so the
-- catalog can address them (the demo corpus was keyed by slug); lessons gain the
-- authoring fields the editor writes (reading body, practice hint, quiz link).

-- AlterTable
ALTER TABLE "courses" ADD COLUMN "slug" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE UNIQUE INDEX "courses_tenantId_slug_key" ON "courses"("tenantId", "slug");

-- AlterTable
ALTER TABLE "lessons" ADD COLUMN "hint" TEXT;
ALTER TABLE "lessons" ADD COLUMN "body" TEXT;
ALTER TABLE "lessons" ADD COLUMN "assessmentId" TEXT;
