import type {
  CourseRecord,
  CourseRepository,
  LessonRecord,
  LessonRepository,
  ModuleRepository,
  ProgressRepository,
} from '../common/ports';

export interface LessonSummaryDto {
  id: string;
  title: string;
  kind: 'video' | 'reading' | 'lab' | 'quiz';
  status: 'not_started' | 'in_progress' | 'complete';
  score?: number | null;
  /** Practice labs only: a progressive hint revealed on request. */
  hint?: string;
  /**
   * Lab lessons only: whether the lesson can be launched (it is an
   * `interactive_lab` with an `exerciseSlug`). A `lab`-kind lesson without a
   * slug is a content gap; the UI disables the launch control instead of
   * letting the student hit a 401.
   */
  launchable?: boolean;
}

export interface CourseSummaryDto {
  /** Stable system-of-record course id; used by enrolment, not display. */
  id: string;
  slug: string;
  title: string;
  description: string;
  lessons: LessonSummaryDto[];
}

/** A single lesson opened in the viewer: its text plus where to go next. */
export interface LessonDetailDto {
  id: string;
  title: string;
  kind: 'video' | 'reading' | 'lab' | 'quiz';
  status: 'not_started' | 'in_progress' | 'complete';
  score?: number | null;
  hint?: string;
  /** Reading/video lesson text (plain text; blank lines separate paragraphs). */
  body?: string;
  /** Quiz lessons only: the assessment to sit. */
  assessmentId?: string;
  /** Lab lessons only: whether the lesson can be launched (see LessonSummaryDto). */
  launchable?: boolean;
  /** The course this lesson belongs to, for a back link. */
  courseSlug: string;
  courseTitle: string;
}

/**
 * Serves the course catalog (system of record) joined with the signed-in
 * student's progress. Only published courses are visible, so a course an
 * instructor is still authoring stays hidden until it is published. Reads are
 * pure over the injected ports, so the DTO shape is unit-testable without a
 * database.
 */
export class CatalogService {
  constructor(
    private readonly courses: CourseRepository,
    private readonly modules: ModuleRepository,
    private readonly lessons: LessonRepository,
    private readonly progress: ProgressRepository,
  ) {}

  async listCourses(tenantId: string, userId: string): Promise<CourseSummaryDto[]> {
    const courses = await this.courses.listByTenant(tenantId);
    return Promise.all(
      courses.filter((c) => c.status === 'published').map((c) => this.toSummary(c, userId)),
    );
  }

  async getCourse(
    tenantId: string,
    slug: string,
    userId: string,
  ): Promise<CourseSummaryDto | null> {
    const course = await this.courses.findBySlug(tenantId, slug);
    if (!course || course.status !== 'published') return null;
    return this.toSummary(course, userId);
  }

  /**
   * A single lesson opened in the viewer. Returns null when no published course
   * owns the lesson id, so a bad link is a clean 404 rather than an empty page.
   */
  async getLesson(
    tenantId: string,
    courseSlug: string,
    lessonId: string,
    userId: string,
  ): Promise<LessonDetailDto | null> {
    const course = await this.courses.findBySlug(tenantId, courseSlug);
    if (!course || course.status !== 'published') return null;

    const lesson = await this.lessons.findById(lessonId);
    if (!lesson) return null;
    const modules = await this.modules.listByCourse(course.id);
    if (!modules.some((m) => m.id === lesson.moduleId)) return null;

    const record = await this.progress.findByUserAndLesson(userId, lesson.id);
    const kind = lessonKind(lesson.type);
    return {
      id: lesson.id,
      title: lesson.title,
      kind,
      status: normalizeStatus(record?.status),
      score: record?.score ?? null,
      hint: lesson.hint ?? undefined,
      body: lesson.body ?? undefined,
      assessmentId: lesson.assessmentId ?? undefined,
      launchable: kind === 'lab' ? Boolean(lesson.exerciseSlug) : undefined,
      courseSlug: course.slug,
      courseTitle: course.title,
    };
  }

  private async toSummary(course: CourseRecord, userId: string): Promise<CourseSummaryDto> {
    const modules = await this.modules.listByCourse(course.id);
    const lessons: LessonSummaryDto[] = [];
    for (const module of modules) {
      const moduleLessons = (await this.lessons.listByModule?.(module.id)) ?? [];
      for (const lesson of moduleLessons) {
        const record = await this.progress.findByUserAndLesson(userId, lesson.id);
        const kind = lessonKind(lesson.type);
        lessons.push({
          id: lesson.id,
          title: lesson.title,
          kind,
          status: normalizeStatus(record?.status),
          score: record?.score ?? null,
          hint: lesson.hint ?? undefined,
          launchable: kind === 'lab' ? Boolean(lesson.exerciseSlug) : undefined,
        });
      }
    }
    return {
      id: course.id,
      slug: course.slug,
      title: course.title,
      description: course.description,
      lessons,
    };
  }
}

/** Map a system-of-record lesson type onto the catalog presentation kind. */
export function lessonKind(type: string): 'video' | 'reading' | 'lab' | 'quiz' {
  if (type === 'interactive_lab') return 'lab';
  if (type === 'quiz') return 'quiz';
  if (type === 'video') return 'video';
  return 'reading';
}

function normalizeStatus(status: string | undefined): LessonSummaryDto['status'] {
  if (status === 'complete' || status === 'in_progress') return status;
  return 'not_started';
}
