import type {
  EnrollmentRepository,
  MembershipRepository,
  ProgressRepository,
  ProjectRepository,
  ProjectSubmissionRepository,
  SocialPostRepository,
  UserRepository,
} from '../common/ports';

/** One item in the student's activity feed. */
export interface FeedItem {
  id: string;
  /** `submission` | `completion` | `post`. */
  kind: string;
  actorId: string;
  actorName: string;
  /** One-line headline, e.g. "submitted Weather App". */
  title: string;
  /** Supporting detail, or null. */
  detail: string | null;
  /** Route to open the item, when there is one. */
  href: string | null;
  createdAt: string;
}

export interface FeedDeps {
  memberships: MembershipRepository;
  enrollments: EnrollmentRepository;
  progress: ProgressRepository;
  users: UserRepository;
  projects: ProjectRepository;
  submissions: ProjectSubmissionRepository;
  posts: SocialPostRepository;
  lessons: { findById(id: string): Promise<{ id: string; title: string } | null> };
}

/** How many recent items the feed returns. */
export const FEED_LIMIT = 30;

/**
 * The Feed surface (parity §2.9): a reverse-chronological stream of what the
 * student's cohort has been doing — project submissions, completed lessons, and
 * social posts. It is derived from the primary tables on read, so it needs no
 * separate write path and cannot drift from the gradebook or the social feed.
 */
export class FeedService {
  constructor(private readonly deps: FeedDeps) {}

  /** The caller's cohort feed, newest first, capped at {@link FEED_LIMIT}. */
  async forUser(userId: string, tenantId: string): Promise<FeedItem[]> {
    const memberships = await this.deps.memberships.listByTenant(tenantId);
    const cohortIds = memberships.map((m) => m.userId);
    if (!cohortIds.includes(userId)) cohortIds.push(userId);

    const nameById = new Map<string, string>();
    for (const id of cohortIds) {
      const user = await this.deps.users.findById(id);
      if (user) nameById.set(id, user.fullName);
    }

    const items: FeedItem[] = [
      ...(await this.submissionItems(tenantId, cohortIds, nameById)),
      ...(await this.completionItems(cohortIds, nameById)),
      ...(await this.postItems(tenantId, cohortIds, nameById)),
    ];

    return items
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, FEED_LIMIT);
  }

  private async submissionItems(
    tenantId: string,
    cohortIds: string[],
    names: Map<string, string>,
  ): Promise<FeedItem[]> {
    const projects = await this.deps.projects.listByTenant(tenantId);
    const items: FeedItem[] = [];
    for (const project of projects) {
      const submissions = await this.deps.submissions.listByProject(tenantId, project.id);
      for (const submission of submissions) {
        if (!cohortIds.includes(submission.userId)) continue;
        items.push({
          id: `submission-${submission.id}`,
          kind: 'submission',
          actorId: submission.userId,
          actorName: names.get(submission.userId) ?? submission.userId,
          title: `submitted ${project.title}`,
          detail: submission.autoScore != null ? `Auto-score ${submission.autoScore}` : null,
          href: `/nimbus`,
          createdAt: submission.submittedAt.toISOString(),
        });
      }
    }
    return items;
  }

  private async completionItems(
    cohortIds: string[],
    names: Map<string, string>,
  ): Promise<FeedItem[]> {
    const progress = await this.deps.progress.listByUsers(cohortIds);
    const items: FeedItem[] = [];
    for (const row of progress) {
      if (row.status !== 'complete' || !row.completedAt) continue;
      const lesson = await this.deps.lessons.findById(row.lessonId);
      items.push({
        id: `completion-${row.userId}-${row.lessonId}`,
        kind: 'completion',
        actorId: row.userId,
        actorName: names.get(row.userId) ?? row.userId,
        title: `completed ${lesson?.title ?? 'a lesson'}`,
        detail: row.score != null ? `Scored ${row.score}` : null,
        href: '/learn',
        createdAt: row.completedAt.toISOString(),
      });
    }
    return items;
  }

  private async postItems(
    tenantId: string,
    cohortIds: string[],
    names: Map<string, string>,
  ): Promise<FeedItem[]> {
    const posts = await this.deps.posts.listByUsers(tenantId, cohortIds);
    return posts.map((post) => ({
      id: `post-${post.id}`,
      kind: 'post',
      actorId: post.userId,
      actorName: names.get(post.userId) ?? post.userId,
      title: post.body.length > 80 ? `${post.body.slice(0, 77)}...` : post.body,
      detail: null,
      href: '/social',
      createdAt: post.createdAt.toISOString(),
    }));
  }
}
