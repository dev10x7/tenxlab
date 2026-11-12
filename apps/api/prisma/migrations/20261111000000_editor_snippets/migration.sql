-- Editor: per-user saved code snippets.

CREATE TABLE "code_snippets" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "stdin" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "code_snippets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "code_snippets_userId_updatedAt_idx" ON "code_snippets"("userId", "updatedAt");

-- AddForeignKey
ALTER TABLE "code_snippets" ADD CONSTRAINT "code_snippets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
