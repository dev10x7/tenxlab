import type { RuntimeTier } from '@tenxlab/contracts';
import type { LabProvider } from '@tenxlab/lab-provider';
import { routeTier } from '@tenxlab/runtime-policy';
import type {
  LabSessionRepository,
  LabSessionRecord,
  LessonRepository,
  MembershipRepository,
  TenantRepository,
} from '../common/ports';
import type { UsageService } from './usage.service';

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
      sessionId: string;
      status: string;
      tier: RuntimeTier;
      ideUrl?: string | null;
    }
  | { ok: false; reason: LaunchFailureReason; message: string };

export type LaunchFailureReason =
  | 'lesson_not_found'
  | 'not_a_lab'
  | 'membership_required'
  | 'tenant_quota_exceeded';

export interface LaunchDeps {
  lessons: LessonRepository;
  memberships: MembershipRepository;
  tenants: TenantRepository;
  sessions: LabSessionRepository;
  /** Null disables real provisioning (unit tests, catalog-only deployments). */
  provider?: LabProvider | null;
  /** Seconds an idle session may live before termination. */
  idleTtlSeconds?: number;
  /** Budget/quota gate. When present, launch enforces the monthly budget too. */
  usage?: UsageService;
}

/**
 * Owns the lab session lifecycle.
 *
 * `launch` validates access and creates a session record, then provisions the
 * sandbox **asynchronously**: a KubeLab vcluster cold start takes minutes, far
 * longer than an HTTP request should block. The caller polls `getSession`
 * until the session reports `ACTIVE` and an `ide_url`.
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

    // Budget gate: a tenant over its monthly spend ceiling cannot start new labs.
    if (this.deps.usage) {
      const denial = await this.deps.usage.checkLaunch(req.tenantId, 0);
      if (denial) {
        return { ok: false, reason: 'tenant_quota_exceeded', message: denial.message };
      }
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

    if (this.deps.provider) {
      void this.provision(session, tier).catch(() => {
        // provision() records the failure on the session row.
      });
    }

    return {
      ok: true,
      sessionId: session.id,
      status: session.status,
      tier,
      ideUrl: session.ideUrl ?? null,
    };
  }

  async getSession(sessionId: string): Promise<LabSessionRecord | null> {
    return this.deps.sessions.findById(sessionId);
  }

  private async provision(session: LabSessionRecord, tier: RuntimeTier): Promise<void> {
    const provider = this.deps.provider;
    if (!provider) return;
    try {
      const handle = await provider.provision({
        exercise_id: session.exerciseSlug,
        runtime_tier: tier,
        tenant_id: session.tenantId,
        user_id: session.userId,
        session_id: session.id,
        ttl_seconds: session.ttlSeconds,
        network_policy: 'allowlist',
      });
      await this.deps.sessions.update(session.id, {
        status: handle.status,
        ideUrl: handle.ide_url ?? null,
        kubelabRef: handle.provider_ref ?? null,
        lastActivityAt: new Date(),
      });
    } catch (err) {
      // Surface the cause: a silent FAILED session is unactionable in ops.
      // eslint-disable-next-line no-console
      console.error(
        `[lab-launch] provisioning failed for session ${session.id}:`,
        err instanceof Error ? `${err.name}: ${err.message}` : err,
      );
      await this.deps.sessions.update(session.id, {
        status: 'FAILED',
        lastActivityAt: new Date(),
      });
    }
  }
}
