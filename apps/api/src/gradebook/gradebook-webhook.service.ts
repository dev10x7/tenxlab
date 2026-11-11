import { CompletionWebhook, verifyHmacSha256 } from '@tenxlab/contracts';
import type {
  EventLedger,
  LabSessionRepository,
  ProgressRepository,
} from '../common/ports';

export type WebhookResult =
  | { ok: true; duplicate: boolean; lessonId?: string }
  | { ok: false; status: number; message: string };

export interface GradebookDeps {
  webhookSecret: string;
  ledger: EventLedger;
  sessions: LabSessionRepository;
  progress: ProgressRepository;
  /** Resolve the lesson id from a lab exercise slug within a tenant. */
  resolveLessonId(exerciseSlug: string, tenantId: string): Promise<string | null>;
  onGraded?: (userId: string, lessonId: string, score: number) => void;
}

/**
 * Receives KubeLab completion webhooks: validates HMAC, enforces idempotency,
 * updates lesson progress, and marks the lab session terminated.
 */
export class GradebookWebhookService {
  constructor(private readonly deps: GradebookDeps) {}

  async handle(
    rawBody: string,
    signature: string | undefined,
  ): Promise<WebhookResult> {
    if (!verifyHmacSha256(this.deps.webhookSecret, rawBody, signature)) {
      return { ok: false, status: 401, message: 'Invalid signature' };
    }

    let payload: CompletionWebhook;
    try {
      payload = CompletionWebhook.parse(JSON.parse(rawBody));
    } catch {
      return { ok: false, status: 422, message: 'Invalid payload' };
    }

    const isNew = await this.deps.ledger.recordIfNew(payload.event_id, 'kubelab');
    if (!isNew) {
      return { ok: true, duplicate: true };
    }

    const lessonId = await this.deps.resolveLessonId(
      payload.exercise_id,
      payload.tenant_id,
    );
    if (!lessonId) {
      return { ok: false, status: 422, message: 'Unknown exercise for tenant' };
    }

    const completed = payload.status === 'PASSED';
    await this.deps.progress.upsert(payload.student_id, lessonId, {
      status: completed ? 'complete' : 'in_progress',
      score: payload.score,
      attempts: payload.attempt_count,
      completedAt: completed ? new Date(payload.timestamp) : null,
    });

    // The session row may already have been reaped by the TTL sweeper; grading
    // must not fail because of that.
    const session = await this.deps.sessions.findById(payload.session_id);
    if (session) {
      await this.deps.sessions.update(payload.session_id, {
        status: 'TERMINATED',
        lastActivityAt: new Date(payload.timestamp),
      });
    }

    this.deps.onGraded?.(payload.student_id, lessonId, payload.score);

    return { ok: true, duplicate: false, lessonId };
  }
}
