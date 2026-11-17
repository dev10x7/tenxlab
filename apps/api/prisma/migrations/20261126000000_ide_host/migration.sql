-- Persist the stable IDE ingress host instead of the fully-composed browser URL.
--
-- The composed URL embeds deployment config (the public gateway base), so
-- storing it stranded every existing row whenever that base changed. The host
-- alone is stable; the URL is now derived at read time.

-- lab_sessions
ALTER TABLE "lab_sessions" ADD COLUMN "ideHost" TEXT;
UPDATE "lab_sessions"
SET "ideHost" = substring("ideUrl" from '^[a-z]+://(?:[^/]+/lab/)?([^/]+)/?$')
WHERE "ideUrl" IS NOT NULL;
ALTER TABLE "lab_sessions" DROP COLUMN "ideUrl";

-- project_workspaces
ALTER TABLE "project_workspaces" ADD COLUMN "ideHost" TEXT;
UPDATE "project_workspaces"
SET "ideHost" = substring("ideUrl" from '^[a-z]+://(?:[^/]+/lab/)?([^/]+)/?$')
WHERE "ideUrl" IS NOT NULL;
ALTER TABLE "project_workspaces" DROP COLUMN "ideUrl";
