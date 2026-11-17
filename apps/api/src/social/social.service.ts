import type {
  SocialFollowRepository,
  SocialPostRecord,
  SocialPostRepository,
  UserRepository,
} from '../common/ports';

/** A post as the web client renders it, with its author resolved. */
export interface PostView {
  id: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string;
}

/** A member the caller can follow, with their follower/following counts. */
export interface MemberView {
  userId: string;
  fullName: string;
  email: string;
  followers: number;
  following: number;
  followedByMe: boolean;
}

/** Max length of a post body. */
export const POST_BODY_MAX = 2000;

export interface SocialDeps {
  posts: SocialPostRepository;
  follows: SocialFollowRepository;
  users: UserRepository;
  memberships: { listByTenant(tenantId: string): Promise<Array<{ userId: string; role: string }>> };
}

/**
 * The Social surface (parity §2.9): a tenant-scoped micro-feed. A student posts
 * a short update and follows peers; the feed can show everyone in the tenant or
 * only the people they follow. It is deliberately small — no reactions or
 * threads — because the value ByteXL's community tab adds is visibility, not
 * another social network.
 */
export class SocialService {
  constructor(private readonly deps: SocialDeps) {}

  /** The tenant feed, newest first; `followingOnly` narrows to followed peers. */
  async feed(
    userId: string,
    tenantId: string,
    options: { followingOnly?: boolean } = {},
  ): Promise<PostView[]> {
    let rows: SocialPostRecord[];
    if (options.followingOnly) {
      const edges = await this.deps.follows.listFollowing(tenantId, userId);
      rows = await this.deps.posts.listByUsers(tenantId, [
        ...edges.map((e) => e.followeeId),
        userId,
      ]);
    } else {
      rows = await this.deps.posts.listByTenant(tenantId);
    }
    return Promise.all(rows.map((row) => this.toView(row)));
  }

  /** Publish a post. */
  async post(
    userId: string,
    tenantId: string,
    body: string,
  ): Promise<{ ok: true; post: PostView } | { ok: false; reason: 'empty' | 'too_long' }> {
    const trimmed = body.trim();
    if (!trimmed) return { ok: false, reason: 'empty' };
    if (trimmed.length > POST_BODY_MAX) return { ok: false, reason: 'too_long' };
    const row = await this.deps.posts.create({ tenantId, userId, body: trimmed });
    return { ok: true, post: await this.toView(row) };
  }

  /** Delete a post the caller owns. */
  async delete(
    userId: string,
    postId: string,
  ): Promise<{ ok: true } | { ok: false; reason: 'not_found' | 'forbidden' }> {
    const row = await this.deps.posts.findById(postId);
    if (!row) return { ok: false, reason: 'not_found' };
    if (row.userId !== userId) return { ok: false, reason: 'forbidden' };
    await this.deps.posts.delete(postId);
    return { ok: true };
  }

  /** Follow a peer. Following yourself is rejected; following twice is a no-op. */
  async follow(
    userId: string,
    tenantId: string,
    followeeId: string,
  ): Promise<{ ok: true } | { ok: false; reason: 'self' | 'unknown_user' }> {
    if (userId === followeeId) return { ok: false, reason: 'self' };
    const target = await this.deps.users.findById(followeeId);
    if (!target) return { ok: false, reason: 'unknown_user' };
    await this.deps.follows.follow({ tenantId, followerId: userId, followeeId });
    return { ok: true };
  }

  /** Unfollow a peer. */
  async unfollow(userId: string, tenantId: string, followeeId: string): Promise<void> {
    await this.deps.follows.unfollow(userId, followeeId);
  }

  /**
   * The tenant directory: every member with their follower/following counts and
   * whether the caller already follows them, so the UI can toggle the button.
   */
  async directory(userId: string, tenantId: string): Promise<MemberView[]> {
    const memberships = await this.deps.memberships.listByTenant(tenantId);
    const following = await this.deps.follows.listFollowing(tenantId, userId);
    const followedIds = new Set(following.map((f) => f.followeeId));

    const out: MemberView[] = [];
    for (const membership of memberships) {
      if (membership.userId === userId) continue;
      const user = await this.deps.users.findById(membership.userId);
      if (!user) continue;
      const [followers, mine] = await Promise.all([
        this.deps.follows.listFollowers(tenantId, membership.userId),
        this.deps.follows.listFollowing(tenantId, membership.userId),
      ]);
      out.push({
        userId: user.id,
        fullName: user.fullName,
        email: user.email,
        followers: followers.length,
        following: mine.length,
        followedByMe: followedIds.has(user.id),
      });
    }
    return out.sort((a, b) => b.followers - a.followers || a.fullName.localeCompare(b.fullName));
  }

  private async toView(row: SocialPostRecord): Promise<PostView> {
    const user = await this.deps.users.findById(row.userId);
    return {
      id: row.id,
      authorId: row.userId,
      authorName: user?.fullName ?? row.userId,
      body: row.body,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
