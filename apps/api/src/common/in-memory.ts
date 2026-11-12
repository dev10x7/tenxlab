import { randomUUID } from 'node:crypto';
import type {
  BatchRecord,
  BatchRepository,
  EnrollmentRecord,
  EnrollmentRepository,
  EventLedger,
  LabSessionRecord,
  LabSessionRepository,
  LessonRecord,
  LessonRepository,
  MembershipRecord,
  MembershipRepository,
  ProgressRepository,
  ReplayGuard,
  SnippetRecord,
  SnippetRepository,
  TenantRecord,
  TenantRepository,
  UserRecord,
  UserRepository,
  LessonProgressRecord,
} from './ports';

/**
 * In-memory adapters for the repository ports. Used in unit tests and as the
 * default local-development store when no database is configured.
 */

export class InMemoryTenantRepository implements TenantRepository {
  constructor(private readonly rows: TenantRecord[] = []) {}
  async findById(id: string) {
    return this.rows.find((t) => t.id === id) ?? null;
  }
  async findByDomain(domain: string) {
    return this.rows.find((t) => t.domain === domain) ?? null;
  }
  seed(t: TenantRecord) {
    this.rows.push(t);
  }
}

export class InMemoryUserRepository implements UserRepository {
  constructor(private readonly rows: UserRecord[] = []) {}
  async findByEmail(email: string) {
    return this.rows.find((u) => u.email === email) ?? null;
  }
  async findById(id: string) {
    return this.rows.find((u) => u.id === id) ?? null;
  }
  async upsertByEmail(email: string, fullName: string) {
    const existing = await this.findByEmail(email);
    if (existing) return existing;
    const user = { id: randomUUID(), email, fullName };
    this.rows.push(user);
    return user;
  }
}

export class InMemoryMembershipRepository implements MembershipRepository {
  constructor(private readonly rows: MembershipRecord[] = []) {}
  async find(userId: string, tenantId: string) {
    return (
      this.rows.find((m) => m.userId === userId && m.tenantId === tenantId) ??
      null
    );
  }
  async listByTenant(tenantId: string) {
    return this.rows.filter((m) => m.tenantId === tenantId);
  }
  async create(userId: string, tenantId: string, role: string) {
    const membership = {
      id: randomUUID(),
      userId,
      tenantId,
      role,
      status: 'active',
    };
    this.rows.push(membership);
    return membership;
  }
  seed(m: MembershipRecord) {
    this.rows.push(m);
  }
}

export class InMemoryLessonRepository implements LessonRepository {
  constructor(private readonly rows: LessonRecord[] = []) {}
  async findById(id: string) {
    return this.rows.find((l) => l.id === id) ?? null;
  }
  async findByExerciseSlug(exerciseSlug: string) {
    return this.rows.find((l) => l.exerciseSlug === exerciseSlug) ?? null;
  }
  seed(l: LessonRecord) {
    this.rows.push(l);
  }
}

export class InMemoryLabSessionRepository implements LabSessionRepository {
  constructor(private readonly rows: LabSessionRecord[] = []) {}
  async create(input: Omit<LabSessionRecord, 'id'>) {
    const row: LabSessionRecord = { id: randomUUID(), ...input };
    this.rows.push(row);
    return row;
  }
  async findById(id: string) {
    return this.rows.find((s) => s.id === id) ?? null;
  }
  async countActiveByTenant(tenantId: string) {
    return this.rows.filter(
      (s) =>
        s.tenantId === tenantId &&
        (s.status === 'WARM' || s.status === 'ACTIVE' || s.status === 'IDLE'),
    ).length;
  }
  async update(id: string, patch: Partial<LabSessionRecord>) {
    const row = this.rows.find((s) => s.id === id);
    if (!row) throw new Error(`lab session ${id} not found`);
    Object.assign(row, patch);
    return row;
  }
}

export class InMemoryProgressRepository implements ProgressRepository {
  constructor(private readonly rows: LessonProgressRecord[] = []) {}
  async findByUserAndLesson(userId: string, lessonId: string) {
    return (
      this.rows.find((p) => p.userId === userId && p.lessonId === lessonId) ??
      null
    );
  }
  async upsert(
    userId: string,
    lessonId: string,
    patch: Partial<LessonProgressRecord>,
  ) {
    const existing = await this.findByUserAndLesson(userId, lessonId);
    if (existing) {
      Object.assign(existing, patch);
      return existing;
    }
    const row: LessonProgressRecord = {
      id: randomUUID(),
      userId,
      lessonId,
      status: 'not_started',
      attempts: 0,
      ...patch,
    };
    this.rows.push(row);
    return row;
  }
  async listByUsers(userIds: string[]) {
    const wanted = new Set(userIds);
    return this.rows.filter((p) => wanted.has(p.userId));
  }
}

export class InMemoryBatchRepository implements BatchRepository {
  constructor(private readonly rows: BatchRecord[] = []) {}
  async create(input: {
    tenantId: string;
    name: string;
    departmentId?: string | null;
    startDate?: Date | null;
    endDate?: Date | null;
  }) {
    const row: BatchRecord = {
      id: randomUUID(),
      tenantId: input.tenantId,
      name: input.name,
      departmentId: input.departmentId ?? null,
      startDate: input.startDate ?? null,
      endDate: input.endDate ?? null,
    };
    this.rows.push(row);
    return row;
  }
  async findById(id: string) {
    return this.rows.find((b) => b.id === id) ?? null;
  }
  async listByTenant(tenantId: string) {
    return this.rows.filter((b) => b.tenantId === tenantId);
  }
  seed(b: BatchRecord) {
    this.rows.push(b);
  }
}

export class InMemoryEnrollmentRepository implements EnrollmentRepository {
  constructor(private readonly rows: EnrollmentRecord[] = []) {}
  async assign(input: {
    userId: string;
    courseId: string;
    batchId?: string | null;
  }) {
    const existing = this.rows.find(
      (e) => e.userId === input.userId && e.courseId === input.courseId,
    );
    if (existing) {
      // Preserve the idempotent contract: re-assigning may attach a batch but
      // never creates a second row for the same course.
      if (input.batchId != null) existing.batchId = input.batchId;
      return existing;
    }
    const row: EnrollmentRecord = {
      id: randomUUID(),
      userId: input.userId,
      courseId: input.courseId,
      batchId: input.batchId ?? null,
    };
    this.rows.push(row);
    return row;
  }
  async listByBatch(batchId: string) {
    return this.rows.filter((e) => e.batchId === batchId);
  }
  seed(e: EnrollmentRecord) {
    this.rows.push(e);
  }
}

export class InMemorySnippetRepository implements SnippetRepository {
  constructor(private readonly rows: SnippetRecord[] = []) {}
  async create(input: {
    userId: string;
    language: string;
    title: string;
    source: string;
    stdin: string;
  }) {
    const now = new Date();
    const row: SnippetRecord = {
      id: randomUUID(),
      userId: input.userId,
      language: input.language,
      title: input.title,
      source: input.source,
      stdin: input.stdin,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.push(row);
    return row;
  }
  async update(
    id: string,
    userId: string,
    patch: Partial<Pick<SnippetRecord, 'title' | 'language' | 'source' | 'stdin'>>,
  ) {
    const row = this.rows.find((s) => s.id === id && s.userId === userId);
    if (!row) return null;
    Object.assign(row, patch, { updatedAt: new Date() });
    return row;
  }
  async listByUser(userId: string) {
    return this.rows
      .filter((s) => s.userId === userId)
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }
  async findById(id: string, userId: string) {
    return this.rows.find((s) => s.id === id && s.userId === userId) ?? null;
  }
  async delete(id: string, userId: string) {
    const index = this.rows.findIndex((s) => s.id === id && s.userId === userId);
    if (index === -1) return false;
    this.rows.splice(index, 1);
    return true;
  }
  seed(s: SnippetRecord) {
    this.rows.push(s);
  }
}

export class InMemoryEventLedger implements EventLedger {
  private readonly seen = new Set<string>();
  async recordIfNew(eventId: string, source: string) {
    const key = `${source}:${eventId}`;
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    return true;
  }
}

export class InMemoryReplayGuard implements ReplayGuard {
  private readonly seen = new Set<string>();
  async claim(jti: string, partnerId: string) {
    const key = `${partnerId}:${jti}`;
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    return true;
  }
}
