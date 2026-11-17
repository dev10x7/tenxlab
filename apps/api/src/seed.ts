/**
 * Seed the Postgres system of record with the demo tenant, users, and course
 * catalog so the containerised stack has something to serve on first boot.
 *
 * Compiled with the API (dist/seed.js) and run by the container entrypoint after
 * migrations. Idempotent: every write is an upsert keyed on a stable id, so
 * re-running it does not duplicate rows.
 */
import { PrismaClient } from '@prisma/client';
import { courseIdForSlug, DEMO_BATCH, DEMO_COURSES } from './catalog/demo-data';
import { DEMO_USERS } from './identity/demo-users';
import { DEMO_PROJECT, DEMO_PROJECT_COMPONENT } from './projects/demo-project';

export async function seed(db: PrismaClient): Promise<void> {
  await db.tenant.upsert({
    where: { id: 'demo-tenant' },
    update: {},
    create: {
      id: 'demo-tenant',
      name: 'Demo College',
      domain: 'demo-college',
      maxConcurrentLabs: 50,
      monthlyBudgetCents: 0,
      maxStorageGb: 0,
      plan: 'standard',
      status: 'active',
    },
  });

  for (const u of DEMO_USERS) {
    await db.user.upsert({
      where: { id: u.id },
      update: { email: u.email, fullName: u.fullName },
      create: { id: u.id, email: u.email, fullName: u.fullName },
    });
    await db.membership.upsert({
      where: { userId_tenantId: { userId: u.id, tenantId: u.tenantId } },
      update: { role: u.role, status: 'active' },
      create: {
        userId: u.id,
        tenantId: u.tenantId,
        role: u.role,
        status: 'active',
      },
    });
  }

  for (const course of DEMO_COURSES) {
    // Course ids are not in the demo corpus; derive a stable id from the slug.
    const courseId = courseIdForSlug(course.slug);
    await db.course.upsert({
      where: { id: courseId },
      update: {
        slug: course.slug,
        title: course.title,
        description: course.description,
        status: 'published',
      },
      create: {
        id: courseId,
        tenantId: 'demo-tenant',
        slug: course.slug,
        title: course.title,
        description: course.description,
        status: 'published',
      },
    });

    for (const [moduleIndex, m] of course.modules.entries()) {
      await db.module.upsert({
        where: { id: m.id },
        update: { title: m.title, position: moduleIndex },
        create: { id: m.id, courseId, title: m.title, position: moduleIndex },
      });
    }

    for (const [lessonIndex, lesson] of course.lessons.entries()) {
      const fields = {
        title: lesson.title,
        type: lesson.type,
        position: lessonIndex,
        exerciseSlug: lesson.exerciseSlug ?? null,
        runtimeTier: lesson.runtimeTier ?? null,
        maxScore: lesson.maxScore,
        hint: lesson.hint ?? null,
        body: lesson.body ?? null,
        assessmentId: lesson.assessmentId ?? null,
      };
      await db.lesson.upsert({
        where: { id: lesson.id },
        update: fields,
        create: { id: lesson.id, moduleId: lesson.moduleId, ...fields },
      });
    }
  }

  // A demo batch with the seeded student enrolled, so the instructor gradebook
  // is populated on first boot.
  await db.academicBatch.upsert({
    where: { id: DEMO_BATCH.id },
    update: { name: DEMO_BATCH.name },
    create: {
      id: DEMO_BATCH.id,
      tenantId: DEMO_BATCH.tenantId,
      name: DEMO_BATCH.name,
    },
  });

  const firstCourse = DEMO_COURSES[0];
  if (firstCourse) {
    await db.enrollment.upsert({
      where: {
        userId_courseId: {
          userId: 'demo-student',
          courseId: courseIdForSlug(firstCourse.slug),
        },
      },
      update: { batchId: DEMO_BATCH.id },
      create: {
        userId: 'demo-student',
        courseId: courseIdForSlug(firstCourse.slug),
        batchId: DEMO_BATCH.id,
      },
    });
  }

  // A published demo project so the Nimbus surface has content on first boot,
  // matching the demo catalog and batch above.
  await db.project.upsert({
    where: { id: DEMO_PROJECT.id },
    update: {
      title: DEMO_PROJECT.title,
      description: DEMO_PROJECT.description,
      runtimeTier: DEMO_PROJECT.runtimeTier,
      status: DEMO_PROJECT.status,
      maxScore: DEMO_PROJECT.maxScore,
    },
    create: {
      id: DEMO_PROJECT.id,
      tenantId: DEMO_PROJECT.tenantId,
      title: DEMO_PROJECT.title,
      description: DEMO_PROJECT.description,
      runtimeTier: DEMO_PROJECT.runtimeTier,
      status: DEMO_PROJECT.status,
      deadline: DEMO_PROJECT.deadline,
      maxScore: DEMO_PROJECT.maxScore,
    },
  });

  await db.projectComponent.upsert({
    where: { id: DEMO_PROJECT_COMPONENT.id },
    update: {
      title: DEMO_PROJECT_COMPONENT.title,
      technology: DEMO_PROJECT_COMPONENT.technology,
      templateSlug: DEMO_PROJECT_COMPONENT.templateSlug,
      position: DEMO_PROJECT_COMPONENT.position,
    },
    create: {
      id: DEMO_PROJECT_COMPONENT.id,
      tenantId: DEMO_PROJECT_COMPONENT.tenantId,
      projectId: DEMO_PROJECT_COMPONENT.projectId,
      title: DEMO_PROJECT_COMPONENT.title,
      technology: DEMO_PROJECT_COMPONENT.technology,
      templateSlug: DEMO_PROJECT_COMPONENT.templateSlug,
      templateWorkspaceId: DEMO_PROJECT_COMPONENT.templateWorkspaceId,
      position: DEMO_PROJECT_COMPONENT.position,
    },
  });
}

/* c8 ignore start -- process wiring, exercised by the container entrypoint */
if (require.main === module) {
  const db = new PrismaClient();
  seed(db)
    .then(() => {
      // eslint-disable-next-line no-console
      console.log('[seed] demo tenant, users, and course catalog are in place');
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[seed] failed', err);
      process.exitCode = 1;
    })
    .finally(() => db.$disconnect());
}
/* c8 ignore stop */
