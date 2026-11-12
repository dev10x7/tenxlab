import type { ProgressRepository } from '../common/ports';
import { courseIdForSlug, DEMO_COURSES, type DemoCourse } from './demo-data';

export interface LessonSummaryDto {
  id: string;
  title: string;
  kind: 'video' | 'reading' | 'lab' | 'quiz';
  status: 'not_started' | 'in_progress' | 'complete';
  score?: number | null;
  /** Practice labs only: a progressive hint revealed on request. */
  hint?: string;
}

export interface CourseSummaryDto {
  /** Stable system-of-record course id; used by enrolment, not display. */
  id: string;
  slug: string;
  title: string;
  description: string;
  lessons: LessonSummaryDto[];
}

/**
 * Serves the course catalog (system of record) joined with the signed-in
 * student's progress. Reads are pure over the demo corpus plus the injected
 * progress port, so the DTO shape is unit-testable without a database.
 */
export class CatalogService {
  constructor(
    private readonly progress: ProgressRepository,
    private readonly courses: DemoCourse[] = DEMO_COURSES,
  ) {}

  async listCourses(userId: string): Promise<CourseSummaryDto[]> {
    return Promise.all(this.courses.map((c) => this.toSummary(c, userId)));
  }

  async getCourse(slug: string, userId: string): Promise<CourseSummaryDto | null> {
    const course = this.courses.find((c) => c.slug === slug);
    if (!course) return null;
    return this.toSummary(course, userId);
  }

  private async toSummary(course: DemoCourse, userId: string): Promise<CourseSummaryDto> {
    const lessons: LessonSummaryDto[] = [];
    for (const lesson of course.lessons) {
      const record = await this.progress.findByUserAndLesson(userId, lesson.id);
      lessons.push({
        id: lesson.id,
        title: lesson.title,
        kind: lesson.kind,
        status: normalizeStatus(record?.status),
        score: record?.score ?? null,
        hint: lesson.hint,
      });
    }
    return {
      id: courseIdForSlug(course.slug),
      slug: course.slug,
      title: course.title,
      description: course.description,
      lessons,
    };
  }
}

function normalizeStatus(status: string | undefined): LessonSummaryDto['status'] {
  if (status === 'complete' || status === 'in_progress') return status;
  return 'not_started';
}
