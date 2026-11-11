import type { RuntimeTier } from '@tenxlab/contracts';
import { routeTier } from '@tenxlab/runtime-policy';
import type {
  LabSessionRepository,
  LabSessionRecord,
  LessonRepository,
  MembershipRepository,
  TenantRepository,
} from '../common/ports';
import type { JwtService } from '../crypto/jwt.service';

export interface LaunchRequest {
  userId: string;
  tenantId: string;
  lessonId: string;
  batchId?: string;
  courseId?: string;
}

export type LaunchResult =
  | {
      ok: true;
      launchUrl: string;
      token: string;
      session: LabSessionRecord;
    }
  | { ok: false; reason: LaunchFailureReason; message: string };

export type LaunchFailureReason =
  | 'lesson_not_found'
  | 'not_a_lab'
  | 'membership_required'
  | 'tenant_quota_exceeded';

export interface LaunchDeps {
  jwt: JwtService;
  lessons: LessonRepository;
  memberships: MembershipRepository;
  tenants: TenantRepository;
  sessions: LabSessionRepository;
  callbackUrl: string;
  kubelabBaseUrl: string;
  /** Seconds an idle session may live before termination. */
  idleTtlSeconds?: number;
}

/**
 * Mints a launch JWT and creates a lab session record. Enforces the tenant's
 * concurrent-lab quota before allowing a new session.
 */
export class LabLaunchService {
  constructor(private readonly deps: LaunchDeps) {}

  async launch(req: LaunchRequest, now = Date.now()): Promise<LaunchResult> {
    const lesson = await this.deps.lessons.findById(req.lessonId);
    if (!lesson) {
      return { ok: false, reason: 'lesson_not_found', message: 'Lesson not found' };
    }
    if (lesson.type !== 'interactive_lab' || !lesson.exerciseSlug) {
      return { ok: false, reason: 'not_a_lab', message: 'Lesson is not an interactive lab' };
    }

    const membership = await this.deps.memberships.find(req.userId, req.tenantId);
    if (!membership || membership.status !== 'active') {
      return {
        ok: false,
        reason: 'membership_required',
        message: 'User is not an active member of this tenant',
      };
    }

    const tenant = await this.deps.tenants.findById(req.tenantId);
    if (!tenant) {
      return { ok: false, reason: 'membership_required', message: 'Tenant not found' };
    }

    const active = await this.deps.sessions.countActiveByTenant(req.tenantId);
    if (active >= tenant.maxConcurrentLabs) {
      return {
        ok: false,
        reason: 'tenant_quota_exceeded',
        message: `Tenant concurrent-lab limit (${tenant.maxConcurrentLabs}) reached`,
      };
    }

    const tier = routeTier({
      declaredTier: lesson.runtimeTier,
      exerciseSlug: lesson.exerciseSlug,
    }).tier;

    const session = await this.deps.sessions.create({
      tenantId: req.tenantId,
      userId: req.userId,
      exerciseSlug: lesson.exerciseSlug,
      tier,
      status: 'WARM',
      startedAt: new Date(now),
      lastActivityAt: new Date(now),
      ttlSeconds: this.deps.idleTtlSeconds ?? 1800,
    });

    const token = this.deps.jwt.issueLaunchToken(
      {
        userId: req.userId,
        tenantId: req.tenantId,
        membershipRole: membership.role as never,
        exerciseId: lesson.exerciseSlug,
        runtimeTier: tier,
        sessionId: session.id,
        callbackUrl: this.deps.callbackUrl,
        batchId: req.batchId,
        courseId: req.courseId,
      },
      now,
    );

    const launchUrl = `${this.deps.kubelabBaseUrl}/launch?token=${encodeURIComponent(token)}`;
    return { ok: true, launchUrl, token, session };
  }
}
