-- E5 one-click hosting: a workspace can expose one of its services on a public
-- URL (a per-workspace ingress) so a student can hand in a live demo link.
-- `deployUrl` is that public URL and `deployPort` the container port it fronts.

-- AlterTable
ALTER TABLE "project_workspaces" ADD COLUMN "deployUrl" TEXT,
ADD COLUMN "deployPort" INTEGER;
