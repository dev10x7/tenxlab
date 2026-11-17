import type {
  AttemptRepository,
  EnrollmentRepository,
  GitConnectionRepository,
  MembershipRepository,
  ProgressRepository,
  ProjectRepository,
  ProjectSubmissionRepository,
  ProjectWorkspaceRepository,
  SnippetRepository,
  UserRepository,
} from '../common/ports';
import type { CourseCatalog, ResolvedCourse } from '../catalog/course-catalog';
import { DEMO_ASSESSMENTS } from '../assessments/demo-assessments';

/** The assessment fields the dashboard needs, without the answer key. */
export interface DashboardAssessment {
  id: string;
  title: string;
  courseSlug: string;
  mode: 'practice' | 'graded';
}

/** One enrolled course shown as an industry roadmap on the dashboard. */
export interface RoadmapView {
  courseId: string;
  slug: string;
  title: string;
  progress: number;
  lessonsComplete: number;
  lessonsTotal: number;
}

/** A competitive standing, either within the university or the student's batch. */
export interface RankView {
  scope: 'university' | 'batch';
  label: string;
  rank: number;
  total: number;
  /** 0-100, higher is better (rank 1 → 100). */
  percentile: number;
  averageScore: number | null;
}

export interface ProfileCompletionItem {
  key: string;
  label: string;
  done: boolean;
}

export interface ProfileCompletionView {
  percent: number;
  items: ProfileCompletionItem[];
}

/**
 * One item in the "Up Next for You" widget: an outstanding project or an
 * untaken assessment, mirroring ByteXL's smarter dashboard.
 */
export interface UpNextItem {
  kind: 'project' | 'assessment';
  id: string;
  title: string;
  /** Route to open the item. */
  href: string;
  /** Deadline as an ISO string, or null when the item is open-ended. */
  dueAt: string | null;
  /** One-line description, e.g. "Project — submit before the deadline". */
  detail: string;
}

/** The "Resume Learning" widget: the exact lesson to continue from. */
export interface ResumeItem {
  courseId: string;
  courseSlug: string;
  courseTitle: string;
  lessonId: string;
  lessonTitle: string;
  href: string;
  /** Course completion percent, 0-100. */
  progress: number;
}

export interface StudentDashboardView {
  studentName: string;
  roadmaps: RoadmapView[];
  rankings: RankView[];
  profile: ProfileCompletionView;
  upNext: UpNextItem[];
  resume: ResumeItem | null;
}

export interface StudentDashboardDeps {
  users: UserRepository;
  memberships: MembershipRepository;
  enrollments: EnrollmentRepository;
  progress: ProgressRepository;
  snippets: SnippetRepository;
  workspaces: ProjectWorkspaceRepository;
  submissions: ProjectSubmissionRepository;
  gitConnections: GitConnectionRepository;
  projects: ProjectRepository;
  attempts: AttemptRepository;
  /** Resolves an enrolment's course to a title and its lessons. */
  courses: CourseCatalog;
  /** Assessments to consider for "Up Next"; defaults to the demo corpus. */
  assessments?: DashboardAssessment[];
}

/**
 * The student dashboard's data: enrolled roadmaps with progress, competitive
 * rankings against the university and the student's batch, and a profile
 * completion checklist.
 *
 * Pure over the injected ports, so every number is unit-testable without a
 * database. Rankings read the same `lesson_progress` rows the instructor
 * gradebook reads, so a score that lands from the lab webhook moves both.
 */
export class DashboardService {
  private readonly assessments: DashboardAssessment[];

  constructor(private readonly deps: StudentDashboardDeps) {
    this.assessments =
      deps.assessments ??
      DEMO_ASSESSMENTS.map((a) => ({
        id: a.id,
        title: a.title,
        courseSlug: a.courseSlug,
        mode: a.mode,
      }));
  }

  async forStudent(userId: string, tenantId: string): Promise<StudentDashboardView> {
    const [user, enrollments, ownProgress] = await Promise.all([
      this.deps.users.findById(userId),
      this.deps.enrollments.listByUser(userId),
      this.deps.progress.listByUsers([userId]),
    ]);

    const courses = await this.resolveCourses(enrollments);
    const roadmaps = courses.map((course) => toRoadmap(course, ownProgress));
    const average = averageScore(ownProgress.map((p) => p.score));
    const rankings = await this.buildRankings(userId, tenantId, enrollments, average);
    const profile = await this.buildProfile(userId, tenantId, enrollments, ownProgress);
    const upNext = await this.buildUpNext(tenantId, userId, courses);
    const resume = this.buildResume(courses, ownProgress);

    return {
      studentName: user?.fullName ?? 'Student',
      roadmaps,
      rankings,
      profile,
      upNext,
      resume,
    };
  }

  /** The distinct courses the student is enrolled in, in enrolment order. */
  private async resolveCourses(
    enrollments: Array<{ courseId: string }>,
  ): Promise<ResolvedCourse[]> {
    const seen = new Set<string>();
    const out: ResolvedCourse[] = [];
    for (const enrollment of enrollments) {
      const course = await this.deps.courses.resolve(enrollment.courseId);
      if (!course || seen.has(course.id)) continue;
      seen.add(course.id);
      out.push(course);
    }
    return out;
  }

  /**
   * "Up Next for You": outstanding projects (published, not yet submitted) and
   * untaken assessments on an enrolled course. Dated items sort soonest-first;
   * open-ended items follow in discovery order.
   */
  private async buildUpNext(
    tenantId: string,
    userId: string,
    courses: ResolvedCourse[],
  ): Promise<UpNextItem[]> {
    const items: UpNextItem[] = [];

    const projects = (await this.deps.projects.listByTenant(tenantId)).filter(
      (p) => p.status === 'published',
    );
    const submissions = await this.deps.submissions.listByUser(tenantId, userId);
    const submitted = new Set(submissions.map((s) => s.projectId));
    for (const project of projects) {
      if (submitted.has(project.id)) continue;
      items.push({
        kind: 'project',
        id: project.id,
        title: project.title,
        href: '/nimbus',
        dueAt: project.deadline ? project.deadline.toISOString() : null,
        detail: project.deadline
          ? 'Project — submit before the deadline'
          : 'Project — open for submissions',
      });
    }

    const enrolledSlugs = new Set(courses.map((c) => c.slug));
    const attempts = await this.deps.attempts.listByUser(userId);
    const attempted = new Set(attempts.map((a) => a.assessmentId));
    for (const assessment of this.assessments) {
      if (!enrolledSlugs.has(assessment.courseSlug) || attempted.has(assessment.id)) {
        continue;
      }
      items.push({
        kind: 'assessment',
        id: assessment.id,
        title: assessment.title,
        href: '/assessments',
        dueAt: null,
        detail: assessment.mode === 'graded' ? 'Graded test' : 'Practice set',
      });
    }

    return items
      .sort((a, b) => {
        if (a.dueAt && b.dueAt) return a.dueAt.localeCompare(b.dueAt);
        if (a.dueAt) return -1;
        if (b.dueAt) return 1;
        return 0;
      })
      .slice(0, 5);
  }

  /**
   * "Resume Learning": the first incomplete lesson of the first enrolled course
   * that is not finished, so a click continues exactly where the student left
   * off. Null once every enrolled course is complete.
   */
  private buildResume(
    courses: ResolvedCourse[],
    progress: Array<{ lessonId: string; status: string }>,
  ): ResumeItem | null {
    const done = new Set(
      progress.filter((p) => p.status === 'complete').map((p) => p.lessonId),
    );
    for (const course of courses) {
      const next = course.lessons.find((l) => !done.has(l.id));
      if (!next) continue;
      const complete = course.lessons.filter((l) => done.has(l.id)).length;
      return {
        courseId: course.id,
        courseSlug: course.slug,
        courseTitle: course.title,
        lessonId: next.id,
        lessonTitle: next.title,
        href: `/courses/${course.slug}/lessons/${next.id}`,
        progress: course.lessons.length
          ? Math.round((complete / course.lessons.length) * 100)
          : 0,
      };
    }
    return null;
  }

  private async buildRankings(
    userId: string,
    tenantId: string,
    enrollments: Array<{ batchId?: string | null }>,
    ownAverage: number | null,
  ): Promise<RankView[]> {
    const rankings: RankView[] = [];

    const batchId = enrollments.find((e) => e.batchId)?.batchId ?? null;
    if (batchId) {
      const roster = await this.deps.enrollments.listByBatch(batchId);
      const userIds = [...new Set(roster.map((e) => e.userId))];
      rankings.push(
        await this.rank('batch', 'Batch Rank', userId, userIds, ownAverage),
      );
    }

    const memberships = await this.deps.memberships.listByTenant(tenantId);
    const studentIds = memberships
      .filter((m) => m.role === 'student')
      .map((m) => m.userId);
    rankings.push(
      await this.rank('university', 'University Rank', userId, studentIds, ownAverage),
    );

    return rankings;
  }

  private async rank(
    scope: RankView['scope'],
    label: string,
    userId: string,
    cohortIds: string[],
    ownAverage: number | null,
  ): Promise<RankView> {
    const userIds = [...new Set(cohortIds)];
    const total = userIds.length;
    const scores = await this.averageScoresFor(userIds, userId, ownAverage);

    // Competition ranking: a tie shares the better rank (1, 2, 2, 4).
    const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
    let rank = total;
    let previous: number | null = null;
    let previousRank = 0;
    ranked.forEach(([id, score], index) => {
      const position = previous === score ? previousRank : index + 1;
      previous = score;
      previousRank = position;
      if (id === userId) rank = position;
    });

    return {
      scope,
      label,
      rank,
      total,
      percentile: percentileFor(rank, total),
      averageScore: scores.get(userId) ?? null,
    };
  }

  private async averageScoresFor(
    userIds: string[],
    selfId: string,
    ownAverage: number | null,
  ): Promise<Map<string, number>> {
    const others = userIds.filter((id) => id !== selfId);
    const rows = others.length ? await this.deps.progress.listByUsers(others) : [];
    const byUser = new Map<string, number[]>();
    for (const row of rows) {
      if (row.score == null) continue;
      const list = byUser.get(row.userId) ?? [];
      list.push(row.score);
      byUser.set(row.userId, list);
    }

    const out = new Map<string, number>();
    for (const id of userIds) {
      if (id === selfId) {
        out.set(id, ownAverage ?? 0);
        continue;
      }
      const list = byUser.get(id) ?? [];
      out.set(id, list.length ? list.reduce((s, n) => s + n, 0) / list.length : 0);
    }
    return out;
  }

  private async buildProfile(
    userId: string,
    tenantId: string,
    enrollments: Array<{ courseId: string }>,
    progress: Array<{ status: string }>,
  ): Promise<ProfileCompletionView> {
    const [snippets, workspaces, submissions, git] = await Promise.all([
      this.deps.snippets.listByUser(userId),
      this.deps.workspaces.listByUser(tenantId, userId),
      this.deps.submissions.listByUser(tenantId, userId),
      this.deps.gitConnections.findByUser(userId, 'github'),
    ]);

    const items: ProfileCompletionItem[] = [
      { key: 'enrolled', label: 'Enrolled in a course', done: enrollments.length > 0 },
      {
        key: 'progress',
        label: 'Started a lesson',
        done: progress.some((p) => p.status !== 'not_started'),
      },
      {
        key: 'completed',
        label: 'Completed a lesson',
        done: progress.some((p) => p.status === 'complete'),
      },
      { key: 'snippet', label: 'Saved an editor snippet', done: snippets.length > 0 },
      { key: 'workspace', label: 'Created a Nimbus workspace', done: workspaces.length > 0 },
      { key: 'submission', label: 'Submitted a project', done: submissions.length > 0 },
      { key: 'github', label: 'Connected GitHub', done: git != null },
    ];

    const done = items.filter((i) => i.done).length;
    return {
      percent: Math.round((done / items.length) * 100),
      items,
    };
  }
}

/** A course's roadmap row, from its lessons and the student's progress. */
function toRoadmap(
  course: ResolvedCourse,
  progress: Array<{ lessonId: string; status: string }>,
): RoadmapView {
  const statusByLesson = new Map(progress.map((p) => [p.lessonId, p.status]));
  const complete = course.lessons.filter(
    (l) => statusByLesson.get(l.id) === 'complete',
  ).length;
  const total = course.lessons.length;
  return {
    courseId: course.id,
    slug: course.slug,
    title: course.title,
    lessonsComplete: complete,
    lessonsTotal: total,
    progress: total === 0 ? 0 : Math.round((complete / total) * 100),
  };
}

/** Mean of the non-null scores, or null when there is nothing graded yet. */
export function averageScore(scores: Array<number | null | undefined>): number | null {
  const graded = scores.filter((s): s is number => s != null);
  if (graded.length === 0) return null;
  return Math.round(graded.reduce((sum, n) => sum + n, 0) / graded.length);
}

/** 0-100, higher is better. A lone cohort member is always 100th percentile. */
export function percentileFor(rank: number, total: number): number {
  if (total <= 1) return 100;
  const clamped = Math.min(Math.max(rank, 1), total);
  return Math.round(((total - clamped) / (total - 1)) * 100);
}
