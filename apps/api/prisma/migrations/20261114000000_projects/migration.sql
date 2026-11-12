-- Phase E projects (ByteXL "Nimbus" equivalent).
--
-- An instructor authors a project with one component per technology; a student
-- forks each component into a durable workspace (files on a volume, compute
-- stopped when idle — ADR-20) and submits the workspace plus optional links; a
-- trainer scores the submission. These tables are deliberately separate from
-- lab_sessions so the lab operator's idle sweep cannot reap a student's
-- long-lived work.

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "runtimeTier" TEXT NOT NULL DEFAULT 'tier_2_container',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "deadline" TIMESTAMP(3),
    "maxScore" INTEGER NOT NULL DEFAULT 100,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_components" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "technology" TEXT NOT NULL,
    "templateSlug" TEXT,
    "templateWorkspaceId" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_workspaces" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "templateSlug" TEXT NOT NULL,
    "runtimeTier" TEXT NOT NULL DEFAULT 'tier_2_container',
    "status" TEXT NOT NULL DEFAULT 'stopped',
    "ideUrl" TEXT,
    "storageRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_forks" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "componentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sourceTemplateSlug" TEXT,
    "sourceWorkspaceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_forks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_submissions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "componentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "githubUrl" TEXT,
    "demoUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'submitted',
    "score" INTEGER,
    "feedback" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "evaluatedAt" TIMESTAMP(3),

    CONSTRAINT "project_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "projects_tenantId_status_idx" ON "projects"("tenantId", "status");

-- CreateIndex
CREATE INDEX "project_components_tenantId_projectId_idx" ON "project_components"("tenantId", "projectId");

-- CreateIndex
CREATE INDEX "project_workspaces_tenantId_userId_idx" ON "project_workspaces"("tenantId", "userId");

-- CreateIndex
CREATE INDEX "project_workspaces_tenantId_status_idx" ON "project_workspaces"("tenantId", "status");

-- CreateIndex
CREATE INDEX "project_forks_tenantId_projectId_idx" ON "project_forks"("tenantId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "project_forks_componentId_userId_key" ON "project_forks"("componentId", "userId");

-- CreateIndex
CREATE INDEX "project_submissions_tenantId_projectId_idx" ON "project_submissions"("tenantId", "projectId");

-- CreateIndex
CREATE INDEX "project_submissions_tenantId_userId_idx" ON "project_submissions"("tenantId", "userId");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_components" ADD CONSTRAINT "project_components_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_components" ADD CONSTRAINT "project_components_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_workspaces" ADD CONSTRAINT "project_workspaces_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_forks" ADD CONSTRAINT "project_forks_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_forks" ADD CONSTRAINT "project_forks_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "project_components"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_forks" ADD CONSTRAINT "project_forks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_forks" ADD CONSTRAINT "project_forks_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "project_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_submissions" ADD CONSTRAINT "project_submissions_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_submissions" ADD CONSTRAINT "project_submissions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

