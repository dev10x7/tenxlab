import type {
  CourseRecord,
  CourseRepository,
  LessonRecord,
  LessonRepository,
  ModuleRecord,
  ModuleRepository,
} from '../common/ports';
import { lessonKind } from '../catalog/catalog.service';

/** A module with its lessons, for the instructor course editor. */
export interface ModuleEditorDto {
  id: string;
  title: string;
  position: number;
  lessons: LessonEditorDto[];
}

export interface LessonEditorDto {
  id: string;
  title: string;
  type: string;
  kind: 'video' | 'reading' | 'lab' | 'quiz';
  position: number;
  maxScore: number;
  exerciseSlug: string | null;
  runtimeTier: string | null;
  hint: string | null;
  body: string | null;
  assessmentId: string | null;
}

/** The full authoring view of a course: drafts included, unlike the catalog. */
export interface CourseEditorDto {
  id: string;
  slug: string;
  title: string;
  description: string;
  status: string;
  modules: ModuleEditorDto[];
}

export type WriteResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: WriteErrorReason; message: string };

export type WriteErrorReason =
  | 'invalid_title'
  | 'invalid_slug'
  | 'slug_taken'
  | 'invalid_type'
  | 'course_not_found'
  | 'module_not_found'
  | 'lesson_not_found';

const LESSON_TYPES = ['video', 'reading', 'interactive_lab', 'quiz'] as const;

/**
 * Course and lesson authoring. Instructors build a course as a tree of modules
 * and lessons, then publish it so students see it in the catalog. Every write is
 * tenant-scoped and every id is resolved through the owning course, so an
 * instructor cannot edit another tenant's course by guessing an id.
 *
 * The service is pure over the injected ports (no NestJS, no Prisma), so its
 * write rules are unit-testable with the in-memory store.
 */
export class CourseAuthoringService {
  constructor(
    private readonly courses: CourseRepository,
    private readonly modules: ModuleRepository,
    private readonly lessons: LessonRepository,
  ) {}

  /** Every course in the tenant — drafts included — for the authoring list. */
  async listCourses(tenantId: string): Promise<CourseEditorDto[]> {
    const courses = await this.courses.listByTenant(tenantId);
    return Promise.all(courses.map((c) => this.toEditor(c)));
  }

  /** One course in full, drafts included. Null when the tenant does not own it. */
  async getCourse(tenantId: string, courseId: string): Promise<CourseEditorDto | null> {
    const course = await this.courses.findById(courseId);
    if (!course || course.tenantId !== tenantId) return null;
    return this.toEditor(course);
  }

  async createCourse(input: {
    tenantId: string;
    title: string;
    description?: string;
  }): Promise<WriteResult<CourseEditorDto>> {
    const title = input.title?.trim();
    if (!title) return fail('invalid_title', 'Title is required');

    const slug = await this.uniqueSlug(input.tenantId, slugify(title));
    const course = await this.courses.create({
      tenantId: input.tenantId,
      slug,
      title,
      description: input.description?.trim() ?? '',
      status: 'draft',
    });
    return { ok: true, value: await this.toEditor(course) };
  }

  async updateCourse(
    tenantId: string,
    courseId: string,
    patch: { title?: string; description?: string; slug?: string },
  ): Promise<WriteResult<CourseEditorDto>> {
    const course = await this.ownedCourse(tenantId, courseId);
    if (!course) return fail('course_not_found', 'Course not found');

    const next: Partial<CourseRecord> = {};
    if (patch.title !== undefined) {
      const title = patch.title.trim();
      if (!title) return fail('invalid_title', 'Title is required');
      next.title = title;
    }
    if (patch.description !== undefined) next.description = patch.description.trim();
    if (patch.slug !== undefined) {
      const slug = slugify(patch.slug);
      if (!slug) return fail('invalid_slug', 'Slug must contain letters or digits');
      const clash = await this.courses.findBySlug(tenantId, slug);
      if (clash && clash.id !== courseId) {
        return fail('slug_taken', `Slug "${slug}" is already used by another course`);
      }
      next.slug = slug;
    }
    const updated = await this.courses.update(courseId, next);
    return { ok: true, value: await this.toEditor(updated) };
  }

  /** Publish a course so students see it in the catalog. */
  async publish(tenantId: string, courseId: string): Promise<WriteResult<CourseEditorDto>> {
    return this.setStatus(tenantId, courseId, 'published');
  }

  /** Return a published course to draft so it disappears from the catalog. */
  async unpublish(tenantId: string, courseId: string): Promise<WriteResult<CourseEditorDto>> {
    return this.setStatus(tenantId, courseId, 'draft');
  }

  async deleteCourse(tenantId: string, courseId: string): Promise<WriteResult<true>> {
    const course = await this.ownedCourse(tenantId, courseId);
    if (!course) return fail('course_not_found', 'Course not found');
    await this.courses.delete(courseId);
    return { ok: true, value: true };
  }

  async addModule(
    tenantId: string,
    courseId: string,
    title: string,
  ): Promise<WriteResult<ModuleEditorDto>> {
    const course = await this.ownedCourse(tenantId, courseId);
    if (!course) return fail('course_not_found', 'Course not found');
    const name = title?.trim();
    if (!name) return fail('invalid_title', 'Module title is required');

    const existing = await this.modules.listByCourse(courseId);
    const module = await this.modules.create({
      courseId,
      title: name,
      position: existing.length,
    });
    return { ok: true, value: { ...module, lessons: [] } };
  }

  async updateModule(
    tenantId: string,
    moduleId: string,
    patch: { title?: string; position?: number },
  ): Promise<WriteResult<ModuleEditorDto>> {
    const module = await this.ownedModule(tenantId, moduleId);
    if (!module) return fail('module_not_found', 'Module not found');
    const next: Partial<ModuleRecord> = {};
    if (patch.title !== undefined) {
      const title = patch.title.trim();
      if (!title) return fail('invalid_title', 'Module title is required');
      next.title = title;
    }
    if (patch.position !== undefined) next.position = patch.position;
    const updated = await this.modules.update(moduleId, next);
    const lessons = (await this.lessons.listByModule?.(moduleId)) ?? [];
    return { ok: true, value: { ...updated, lessons: lessons.map(toEditorLesson) } };
  }

  async deleteModule(tenantId: string, moduleId: string): Promise<WriteResult<true>> {
    const module = await this.ownedModule(tenantId, moduleId);
    if (!module) return fail('module_not_found', 'Module not found');
    await this.modules.delete(moduleId);
    return { ok: true, value: true };
  }

  async addLesson(
    tenantId: string,
    moduleId: string,
    input: {
      title: string;
      type: string;
      maxScore?: number;
      exerciseSlug?: string | null;
      runtimeTier?: string | null;
      hint?: string | null;
      body?: string | null;
      assessmentId?: string | null;
    },
  ): Promise<WriteResult<LessonEditorDto>> {
    const module = await this.ownedModule(tenantId, moduleId);
    if (!module) return fail('module_not_found', 'Module not found');
    const title = input.title?.trim();
    if (!title) return fail('invalid_title', 'Lesson title is required');
    if (!LESSON_TYPES.includes(input.type as (typeof LESSON_TYPES)[number])) {
      return fail('invalid_type', `Lesson type must be one of ${LESSON_TYPES.join(', ')}`);
    }

    const existing = (await this.lessons.listByModule?.(moduleId)) ?? [];
    const lesson = await this.lessons.create?.({
      moduleId,
      title,
      type: input.type,
      position: existing.length,
      maxScore: input.maxScore ?? defaultScore(input.type),
      exerciseSlug: input.exerciseSlug?.trim() || null,
      runtimeTier: input.runtimeTier ?? null,
      hint: input.hint?.trim() || null,
      body: input.body ?? null,
      assessmentId: input.assessmentId?.trim() || null,
    });
    if (!lesson) return fail('invalid_type', 'Lesson storage is unavailable');
    return { ok: true, value: toEditorLesson(lesson) };
  }

  async updateLesson(
    tenantId: string,
    lessonId: string,
    patch: {
      title?: string;
      type?: string;
      position?: number;
      maxScore?: number;
      exerciseSlug?: string | null;
      runtimeTier?: string | null;
      hint?: string | null;
      body?: string | null;
      assessmentId?: string | null;
    },
  ): Promise<WriteResult<LessonEditorDto>> {
    const lesson = await this.ownedLesson(tenantId, lessonId);
    if (!lesson) return fail('lesson_not_found', 'Lesson not found');

    const next: Partial<LessonRecord> = {};
    if (patch.title !== undefined) {
      const title = patch.title.trim();
      if (!title) return fail('invalid_title', 'Lesson title is required');
      next.title = title;
    }
    if (patch.type !== undefined) {
      if (!LESSON_TYPES.includes(patch.type as (typeof LESSON_TYPES)[number])) {
        return fail('invalid_type', `Lesson type must be one of ${LESSON_TYPES.join(', ')}`);
      }
      next.type = patch.type;
    }
    if (patch.position !== undefined) next.position = patch.position;
    if (patch.maxScore !== undefined) next.maxScore = patch.maxScore;
    if (patch.exerciseSlug !== undefined) next.exerciseSlug = patch.exerciseSlug?.trim() || null;
    if (patch.runtimeTier !== undefined) next.runtimeTier = patch.runtimeTier;
    if (patch.hint !== undefined) next.hint = patch.hint?.trim() || null;
    if (patch.body !== undefined) next.body = patch.body;
    if (patch.assessmentId !== undefined) {
      next.assessmentId = patch.assessmentId?.trim() || null;
    }

    const updated = await this.lessons.update?.(lessonId, next);
    if (!updated) return fail('lesson_not_found', 'Lesson not found');
    return { ok: true, value: toEditorLesson(updated) };
  }

  async deleteLesson(tenantId: string, lessonId: string): Promise<WriteResult<true>> {
    const lesson = await this.ownedLesson(tenantId, lessonId);
    if (!lesson) return fail('lesson_not_found', 'Lesson not found');
    await this.lessons.delete?.(lessonId);
    return { ok: true, value: true };
  }

  private async setStatus(
    tenantId: string,
    courseId: string,
    status: string,
  ): Promise<WriteResult<CourseEditorDto>> {
    const course = await this.ownedCourse(tenantId, courseId);
    if (!course) return fail('course_not_found', 'Course not found');
    const updated = await this.courses.update(courseId, { status });
    return { ok: true, value: await this.toEditor(updated) };
  }

  private async ownedCourse(
    tenantId: string,
    courseId: string,
  ): Promise<CourseRecord | null> {
    const course = await this.courses.findById(courseId);
    return course && course.tenantId === tenantId ? course : null;
  }

  /** A module the tenant owns, resolved through its course. */
  private async ownedModule(
    tenantId: string,
    moduleId: string,
  ): Promise<ModuleRecord | null> {
    const module = await this.modules.findById(moduleId);
    if (!module) return null;
    return (await this.ownedCourse(tenantId, module.courseId)) ? module : null;
  }

  /** A lesson the tenant owns, resolved through its module and course. */
  private async ownedLesson(
    tenantId: string,
    lessonId: string,
  ): Promise<LessonRecord | null> {
    const lesson = await this.lessons.findById(lessonId);
    if (!lesson) return null;
    return (await this.ownedModule(tenantId, lesson.moduleId)) ? lesson : null;
  }

  private async uniqueSlug(tenantId: string, base: string): Promise<string> {
    const root = base || 'course';
    let slug = root;
    let n = 2;
    while (await this.courses.findBySlug(tenantId, slug)) {
      slug = `${root}-${n++}`;
    }
    return slug;
  }

  private async toEditor(course: CourseRecord): Promise<CourseEditorDto> {
    const modules = await this.modules.listByCourse(course.id);
    const out: ModuleEditorDto[] = [];
    for (const module of modules) {
      const lessons = (await this.lessons.listByModule?.(module.id)) ?? [];
      out.push({
        id: module.id,
        title: module.title,
        position: module.position,
        lessons: lessons.map(toEditorLesson),
      });
    }
    return {
      id: course.id,
      slug: course.slug,
      title: course.title,
      description: course.description,
      status: course.status,
      modules: out,
    };
  }
}

function toEditorLesson(lesson: LessonRecord): LessonEditorDto {
  return {
    id: lesson.id,
    title: lesson.title,
    type: lesson.type,
    kind: lessonKind(lesson.type),
    position: lesson.position ?? 0,
    maxScore: lesson.maxScore,
    exerciseSlug: lesson.exerciseSlug ?? null,
    runtimeTier: lesson.runtimeTier ?? null,
    hint: lesson.hint ?? null,
    body: lesson.body ?? null,
    assessmentId: lesson.assessmentId ?? null,
  };
}

function defaultScore(type: string): number {
  return type === 'reading' || type === 'video' ? 0 : 100;
}

/** A URL-safe key derived from a title; empty when the title has no ASCII. */
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function fail<T>(reason: WriteErrorReason, message: string): WriteResult<T> {
  return { ok: false, reason, message };
}
