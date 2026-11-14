-- Git publish (ByteXL's IDE Source Control push): a student connects their
-- GitHub account once and publishes a workspace to their own repository.
-- `git_connections` holds the encrypted access token; `git_publishes` records
-- each push so the Nimbus UI can show where the code landed.

-- CreateTable
CREATE TABLE "git_connections" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'github',
    "login" TEXT NOT NULL,
    "tokenCiphertext" TEXT NOT NULL,
    "scopes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "git_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "git_publishes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "repoFullName" TEXT NOT NULL,
    "repoUrl" TEXT NOT NULL,
    "branch" TEXT NOT NULL DEFAULT 'main',
    "status" TEXT NOT NULL DEFAULT 'succeeded',
    "commitSha" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "git_publishes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "git_connections_userId_provider_key" ON "git_connections"("userId", "provider");
CREATE INDEX "git_connections_tenantId_userId_idx" ON "git_connections"("tenantId", "userId");
CREATE INDEX "git_publishes_workspaceId_idx" ON "git_publishes"("workspaceId");
CREATE INDEX "git_publishes_tenantId_userId_idx" ON "git_publishes"("tenantId", "userId");
