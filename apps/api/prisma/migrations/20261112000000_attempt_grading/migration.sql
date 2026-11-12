-- P2 Assessments: the server-owned attempt clock plus stored answers/results.
-- The proctoring_events table already exists (attemptId, type, payload); this
-- migration only adds the columns the attempt needs to be graded and re-shown.

ALTER TABLE "attempts" ADD COLUMN "endsAt" TIMESTAMP(3);
ALTER TABLE "attempts" ADD COLUMN "answers" TEXT;
ALTER TABLE "attempts" ADD COLUMN "results" TEXT;
