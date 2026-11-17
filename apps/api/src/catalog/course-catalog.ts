import type { CourseRepository, LessonRepository, ModuleRepository } from '../common/ports';

/** A course resolved from the repository: its identity plus its lessons in order. */
export interface ResolvedCourse {
  id: string;
  slug: string;
  title: string;
  /** Lessons across the course's modules, in display order. */
  lessons: Array<{ id: string; title: string }>;
}

/**
 * Resolves a stored courseId to the course and its lessons. An enrolment and a
 * gradebook both key on a courseId, so they resolve the same way: walk
 * course → modules → lessons through the repositories. A course an instructor
 * authored a minute ago resolves exactly like a seeded one.
 */
export interface CourseCatalog {
  resolve(courseId: string): Promise<ResolvedCourse | null>;
}

export function courseCatalogFrom(
  courses: CourseRepository,
  modules: ModuleRepository,
  lessons: LessonRepository,
): CourseCatalog {
  return {
    async resolve(courseId: string): Promise<ResolvedCourse | null> {
      const course = await courses.findById(courseId);
      if (!course) return null;
      const resolved: Array<{ id: string; title: string }> = [];
      for (const module of await modules.listByCourse(course.id)) {
        for (const lesson of (await lessons.listByModule?.(module.id)) ?? []) {
          resolved.push({ id: lesson.id, title: lesson.title });
        }
      }
      return { id: course.id, slug: course.slug, title: course.title, lessons: resolved };
    },
  };
}
