import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import {
  PrismaBatchRepository,
  PrismaEnrollmentRepository,
  PrismaEventLedger,
  PrismaLabSessionRepository,
  PrismaLessonRepository,
  PrismaMembershipRepository,
  PrismaProgressRepository,
  PrismaProjectComponentRepository,
  PrismaProjectForkRepository,
  PrismaProjectRepository,
  PrismaProjectSubmissionRepository,
  PrismaProjectWorkspaceRepository,
  PrismaReplayGuard,
  PrismaSnippetRepository,
  PrismaTenantRepository,
  PrismaUserRepository,
} from './prisma-repositories';

/**
 * Integration tests for the Prisma adapters. These run against a real Postgres
 * (no mocks) so the row <-> record mapping and the upsert/skip-duplicate SQL are
 * exercised for real.
 *
 * Enabled only when a database is configured, so `npm test` stays green in
 * environments without one:
 *
 *   DATABASE_URL=postgresql://tenxlab:tenxlab@localhost:5432/tenxlab \
 *     node --test dist/common/prisma-repositories.test.js
 */

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const enabled = Boolean(DATABASE_URL);
const suffix = `it-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

test(
  'Prisma adapters round-trip against a real database',
  { skip: enabled ? false : 'DATABASE_URL not set' },
  async () => {
    const db = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
    const tenantId = `tenant-${suffix}`;
    const userId = `user-${suffix}`;
    const email = `${suffix}@test.local`;

    try {
      // --- tenancy
      const tenants = new PrismaTenantRepository(db);
      await db.tenant.create({
        data: {
          id: tenantId,
          name: 'Integration College',
          domain: `domain-${suffix}`,
          maxConcurrentLabs: 7,
          plan: 'trial',
          status: 'active',
        },
      });
      const byId = await tenants.findById(tenantId);
      assert.equal(byId?.maxConcurrentLabs, 7);
      const byDomain = await tenants.findByDomain(`domain-${suffix}`);
      assert.equal(byDomain?.id, tenantId);

      // --- users + memberships
      const users = new PrismaUserRepository(db);
      const created = await users.upsertByEmail(email, 'Integration User');
      assert.equal(created.email, email);
      // upsert is idempotent on the unique email.
      const again = await users.upsertByEmail(email, 'Integration User');
      assert.equal(again.id, created.id);

      const memberships = new PrismaMembershipRepository(db);
      const m = await memberships.create(created.id, tenantId, 'student');
      assert.equal(m.role, 'student');
      const found = await memberships.find(created.id, tenantId);
      assert.equal(found?.status, 'active');
      assert.equal((await memberships.listByTenant(tenantId)).length, 1);

      // --- lessons resolve by exercise slug
      const courseId = `course-${suffix}`;
      const moduleId = `module-${suffix}`;
      const lessonId = `lesson-${suffix}`;
      await db.course.create({
        data: { id: courseId, tenantId, title: 'C', status: 'published' },
      });
      await db.module.create({ data: { id: moduleId, courseId, title: 'M' } });
      await db.lesson.create({
        data: {
          id: lessonId,
          moduleId,
          title: 'Lab',
          type: 'interactive_lab',
          exerciseSlug: `slug-${suffix}`,
          runtimeTier: 'tier_3_vcluster',
          maxScore: 100,
        },
      });
      const lessons = new PrismaLessonRepository(db);
      const lesson = await lessons.findByExerciseSlug(`slug-${suffix}`);
      assert.equal(lesson?.id, lessonId);
      assert.equal(lesson?.runtimeTier, 'tier_3_vcluster');
      assert.equal((await lessons.findById(lessonId))?.maxScore, 100);

      // --- progress upsert creates then updates one row
      const progress = new PrismaProgressRepository(db);
      const p1 = await progress.upsert(created.id, lessonId, {
        status: 'in_progress',
        attempts: 1,
      });
      assert.equal(p1.status, 'in_progress');
      const p2 = await progress.upsert(created.id, lessonId, {
        status: 'complete',
        score: 90,
      });
      assert.equal(p2.id, p1.id);
      assert.equal(p2.status, 'complete');
      assert.equal(p2.score, 90);

      // --- lab sessions: create, count active, update
      const sessions = new PrismaLabSessionRepository(db);
      const s = await sessions.create({
        tenantId,
        userId: created.id,
        exerciseSlug: `slug-${suffix}`,
        tier: 'tier_3_vcluster',
        status: 'WARM',
        startedAt: new Date(),
        lastActivityAt: new Date(),
        ttlSeconds: 1800,
      });
      assert.equal(await sessions.countActiveByTenant(tenantId), 1);
      const updated = await sessions.update(s.id, { status: 'ACTIVE', ideUrl: 'https://ide' });
      assert.equal(updated.status, 'ACTIVE');
      assert.equal(updated.ideUrl, 'https://ide');
      assert.equal((await sessions.findById(s.id))?.status, 'ACTIVE');

      // --- warm pool inventory: the operator's claim/reap surface
      await db.warmSandbox.create({
        data: { tier: 'tier_2_container', providerRef: `ns-${suffix}` },
      });
      const warm = await db.warmSandbox.findMany({ where: { tier: 'tier_2_container' } });
      assert.equal(warm.filter((w) => w.providerRef === `ns-${suffix}`).length, 1);
      await db.warmSandbox.deleteMany({ where: { providerRef: `ns-${suffix}` } });
      assert.equal(
        (await db.warmSandbox.findMany({ where: { providerRef: `ns-${suffix}` } })).length,
        0,
      );

      // --- idempotency ledger and SSO replay guard reject duplicates
      const ledger = new PrismaEventLedger(db);
      assert.equal(await ledger.recordIfNew(`evt-${suffix}`, 'kubelab'), true);
      assert.equal(await ledger.recordIfNew(`evt-${suffix}`, 'kubelab'), false);

      const replay = new PrismaReplayGuard(db);
      assert.equal(await replay.claim(`jti-${suffix}`, 'partner'), true);
      assert.equal(await replay.claim(`jti-${suffix}`, 'partner'), false);

      // --- batches and enrolments
      const batches = new PrismaBatchRepository(db);
      const batch = await batches.create({ tenantId, name: 'Integration Batch' });
      assert.equal(batch.name, 'Integration Batch');
      assert.equal((await batches.findById(batch.id))?.tenantId, tenantId);
      assert.equal((await batches.listByTenant(tenantId)).length, 1);

      const enrollments = new PrismaEnrollmentRepository(db);
      const e1 = await enrollments.assign({
        userId: created.id,
        courseId,
        batchId: batch.id,
      });
      assert.equal(e1.batchId, batch.id);
      // Re-assigning the same course upserts rather than duplicating.
      const e2 = await enrollments.assign({
        userId: created.id,
        courseId,
        batchId: batch.id,
      });
      assert.equal(e2.id, e1.id);
      assert.equal((await enrollments.listByBatch(batch.id)).length, 1);

      // --- progress listByUsers feeds the gradebook
      const forUsers = await progress.listByUsers([created.id]);
      assert.equal(forUsers.length, 1);
      assert.equal(forUsers[0]?.score, 90);

      // --- editor snippets round-trip and stay scoped to their owner
      const snippets = new PrismaSnippetRepository(db);
      const snippet = await snippets.create({
        userId: created.id,
        language: 'python',
        title: 'Two Sum',
        source: 'print(1)',
        stdin: '',
      });
      assert.equal((await snippets.findById(snippet.id, created.id))?.title, 'Two Sum');
      assert.equal(await snippets.findById(snippet.id, 'someone-else'), null);
      const renamed = await snippets.update(snippet.id, created.id, { title: 'Renamed' });
      assert.equal(renamed?.title, 'Renamed');
      assert.equal(await snippets.update(snippet.id, 'someone-else', { title: 'nope' }), null);
      assert.equal((await snippets.listByUser(created.id)).length, 1);
      assert.equal(await snippets.delete(snippet.id, 'someone-else'), false);
      assert.equal(await snippets.delete(snippet.id, created.id), true);

      // --- projects: create -> component -> fork -> submit -> evaluate
      const projects = new PrismaProjectRepository(db);
      const project = await projects.create({
        tenantId,
        title: 'Build an API',
        description: 'A REST service',
        runtimeTier: 'tier_2_container',
        status: 'published',
        deadline: null,
        maxScore: 100,
      });
      assert.equal((await projects.listByTenant(tenantId)).length, 1);
      const closed = await projects.update(project.id, { status: 'closed' });
      assert.equal(closed.status, 'closed');

      const components = new PrismaProjectComponentRepository(db);
      const component = await components.create({
        tenantId,
        projectId: project.id,
        title: 'REST API service',
        technology: 'spring-boot',
        templateSlug: 'spring-boot',
        templateWorkspaceId: null,
        position: 0,
      });
      assert.equal((await components.listByProject(project.id)).length, 1);
      assert.equal((await components.findById(component.id))?.technology, 'spring-boot');

      const workspaces = new PrismaProjectWorkspaceRepository(db);
      const workspace = await workspaces.create({
        tenantId,
        userId: created.id,
        templateSlug: 'spring-boot',
        runtimeTier: 'tier_2_container',
        status: 'provisioning',
        ideUrl: null,
        storageRef: null,
      });
      const stopped = await workspaces.update(workspace.id, {
        status: 'stopped',
        storageRef: `vol-${suffix}`,
      });
      assert.equal(stopped.status, 'stopped');
      assert.equal(stopped.storageRef, `vol-${suffix}`);
      assert.equal((await workspaces.listByUser(tenantId, created.id)).length, 1);

      const forks = new PrismaProjectForkRepository(db);
      const fork = await forks.create({
        tenantId,
        projectId: project.id,
        componentId: component.id,
        userId: created.id,
        workspaceId: workspace.id,
        sourceTemplateSlug: 'spring-boot',
        sourceWorkspaceId: null,
      });
      assert.equal(
        (await forks.findByComponentAndUser(component.id, created.id))?.id,
        fork.id,
      );
      assert.equal(
        (await forks.listByProjectAndUser(project.id, created.id)).length,
        1,
      );
      assert.equal((await forks.listByProject(project.id)).length, 1);
      assert.equal((await forks.findById(fork.id))?.workspaceId, workspace.id);

      const submissions = new PrismaProjectSubmissionRepository(db);
      const submission = await submissions.create({
        tenantId,
        projectId: project.id,
        componentId: component.id,
        userId: created.id,
        workspaceId: workspace.id,
        title: 'My API',
        description: 'submitted',
        githubUrl: 'https://github.com/example/api',
        demoUrl: null,
        status: 'submitted',
        score: null,
        feedback: null,
      });
      assert.equal(submission.evaluatedAt, null);
      const evaluated = await submissions.update(submission.id, {
        status: 'evaluated',
        score: 91,
        feedback: 'Nice work',
        evaluatedAt: new Date(),
      });
      assert.equal(evaluated.score, 91);
      assert.equal((await submissions.listByProject(tenantId, project.id)).length, 1);
      assert.equal((await submissions.listByUser(tenantId, created.id)).length, 1);
    } finally {
      // Cascades clean up memberships, progress, sessions, lessons, modules.
      await db.tenant.deleteMany({ where: { id: tenantId } });
      await db.user.deleteMany({ where: { id: userId } });
      await db.user.deleteMany({ where: { email } });
      await db.course.deleteMany({ where: { id: `course-${suffix}` } });
      await db.processedEvent.deleteMany({ where: { eventId: `evt-${suffix}` } });
      await db.partnerSsoReplay.deleteMany({ where: { jti: `jti-${suffix}` } });
      await db.$disconnect();
    }
  },
);
