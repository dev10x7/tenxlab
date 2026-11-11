import { randomUUID } from 'node:crypto';
import type {
  EventLedger,
  LabSessionRecord,
  LabSessionRepository,
  LessonRecord,
  LessonRepository,
  MembershipRecord,
  MembershipRepository,
  ProgressRepository,
  ReplayGuard,
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
