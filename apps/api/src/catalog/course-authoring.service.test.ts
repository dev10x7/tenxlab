import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  InMemoryCourseRepository,
  InMemoryLessonRepository,
  InMemoryModuleRepository,
  InMemoryProgressRepository,
} from '../common/in-memory';
import { CourseAuthoringService, slugify } from './course-authoring.service';
import { CatalogService } from './catalog.service';

function build() {
  const courses = new InMemoryCourseRepository();
  const modules = new InMemoryModuleRepository();
  const lessons = new InMemoryLessonRepository();
  const authoring = new CourseAuthoringService(courses, modules, lessons);
  const catalog = new CatalogService(courses, modules, lessons, new InMemoryProgressRepository());
  return { authoring, catalog };
}

test('slugify produces a url-safe key', () => {
  assert.equal(slugify('Intro to Kubernetes!'), 'intro-to-kubernetes');
  assert.equal(slugify('  Ça va  '), 'ca-va');
  assert.equal(slugify('!!!'), '');
});

test('creating a course derives a unique slug and starts as a draft', async () => {
  const { authoring } = build();
  const first = await authoring.createCourse({ tenantId: 't1', title: 'Intro to Go' });
  assert.equal(first.ok, true);
  if (!first.ok) return;
  assert.equal(first.value.slug, 'intro-to-go');
  assert.equal(first.value.status, 'draft');

  const second = await authoring.createCourse({ tenantId: 't1', title: 'Intro to Go' });
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.equal(second.value.slug, 'intro-to-go-2');
});

test('a course with no title is rejected', async () => {
  const { authoring } = build();
  const result = await authoring.createCourse({ tenantId: 't1', title: '   ' });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'invalid_title');
});

test('modules and lessons are ordered and scoped to their course', async () => {
  const { authoring } = build();
  const course = await authoring.createCourse({ tenantId: 't1', title: 'Cloud' });
  if (!course.ok) throw new Error('course not created');
  const courseId = course.value.id;

  const m1 = await authoring.addModule('t1', courseId, 'Foundations');
  const m2 = await authoring.addModule('t1', courseId, 'Advanced');
  if (!m1.ok || !m2.ok) throw new Error('modules not created');
  assert.equal(m1.value.position, 0);
  assert.equal(m2.value.position, 1);

  const l1 = await authoring.addLesson('t1', m1.value.id, { title: 'Pods', type: 'reading' });
  const l2 = await authoring.addLesson('t1', m1.value.id, { title: 'Lab', type: 'interactive_lab' });
  if (!l1.ok || !l2.ok) throw new Error('lessons not created');
  assert.equal(l1.value.position, 0);
  assert.equal(l2.value.position, 1);
  assert.equal(l1.value.kind, 'reading');
  assert.equal(l2.value.kind, 'lab');

  const full = await authoring.getCourse('t1', courseId);
  assert.equal(full?.modules.length, 2);
  assert.equal(full?.modules[0]?.lessons.length, 2);
});

test('an unknown lesson type is rejected', async () => {
  const { authoring } = build();
  const course = await authoring.createCourse({ tenantId: 't1', title: 'Cloud' });
  if (!course.ok) throw new Error('course not created');
  const mod = await authoring.addModule('t1', course.value.id, 'M');
  if (!mod.ok) throw new Error('module not created');
  const result = await authoring.addLesson('t1', mod.value.id, { title: 'X', type: 'pdf' });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.reason, 'invalid_type');
});

test('authoring is tenant-scoped: another tenant cannot see or edit a course', async () => {
  const { authoring } = build();
  const course = await authoring.createCourse({ tenantId: 't1', title: 'Cloud' });
  if (!course.ok) throw new Error('course not created');
  const courseId = course.value.id;

  assert.equal(await authoring.getCourse('t2', courseId), null);
  const patch = await authoring.updateCourse('t2', courseId, { title: 'Hijacked' });
  assert.equal(patch.ok, false);
  if (patch.ok) return;
  assert.equal(patch.reason, 'course_not_found');
  assert.equal((await authoring.listCourses('t2')).length, 0);
});

test('a published course is visible in the catalog; a draft is hidden', async () => {
  const { authoring, catalog } = build();
  const course = await authoring.createCourse({ tenantId: 't1', title: 'Cloud' });
  if (!course.ok) throw new Error('course not created');
  const courseId = course.value.id;

  assert.equal((await catalog.listCourses('t1', 'u1')).length, 0);
  await authoring.publish('t1', courseId);
  assert.equal((await catalog.listCourses('t1', 'u1')).length, 1);
  await authoring.unpublish('t1', courseId);
  assert.equal((await catalog.listCourses('t1', 'u1')).length, 0);
});

test('renaming a course slug rejects a slug already used by another course', async () => {
  const { authoring } = build();
  const a = await authoring.createCourse({ tenantId: 't1', title: 'Alpha' });
  const b = await authoring.createCourse({ tenantId: 't1', title: 'Beta' });
  if (!a.ok || !b.ok) throw new Error('courses not created');

  const clash = await authoring.updateCourse('t1', b.value.id, { slug: 'alpha' });
  assert.equal(clash.ok, false);
  if (clash.ok) return;
  assert.equal(clash.reason, 'slug_taken');

  const kept = await authoring.updateCourse('t1', b.value.id, { slug: 'beta' });
  assert.equal(kept.ok, true);
});

test('deleting a course removes it from the authoring list', async () => {
  const { authoring } = build();
  const course = await authoring.createCourse({ tenantId: 't1', title: 'Cloud' });
  if (!course.ok) throw new Error('course not created');
  await authoring.deleteCourse('t1', course.value.id);
  assert.equal((await authoring.listCourses('t1')).length, 0);
});
