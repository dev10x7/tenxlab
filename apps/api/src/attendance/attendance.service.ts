import type {
  AttendanceRepository,
  BatchRepository,
  ClassSessionRepository,
  EnrollmentRepository,
  UserRepository,
} from '../common/ports';

/** The statuses a trainer may record for a student at a session. */
export const ATTENDANCE_STATUSES = ['present', 'absent', 'late', 'excused'] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

/** 'not_marked' is a read-only state: no record exists for that pair yet. */
export type AttendanceCellStatus = AttendanceStatus | 'not_marked';

export interface AttendanceCounts {
  present: number;
  absent: number;
  late: number;
  excused: number;
  /** Sessions with a recorded status (excludes 'not_marked'). */
  marked: number;
}

export interface AttendanceSummary {
  /** present + late over marked, non-excused sessions, 0-100. */
  percent: number;
  counts: AttendanceCounts;
}

export interface SessionAttendanceDto {
  sessionId: string;
  title: string;
  scheduledAt: string;
  status: AttendanceCellStatus;
}

/** The student's own attendance: an overall figure plus the per-session list. */
export interface StudentAttendanceView {
  overall: AttendanceSummary;
  sessions: SessionAttendanceDto[];
}

export interface AttendanceCellDto {
  sessionId: string;
  status: AttendanceCellStatus;
}

export interface BatchAttendanceRowDto {
  userId: string;
  fullName: string;
  email: string;
  percent: number;
  counts: AttendanceCounts;
  cells: AttendanceCellDto[];
}

export interface BatchAttendanceDto {
  batchId: string;
  batchName: string;
  sessions: Array<{ id: string; title: string; scheduledAt: string }>;
  rows: BatchAttendanceRowDto[];
}

export interface ClassSessionDto {
  id: string;
  batchId: string;
  title: string;
  scheduledAt: string;
}

export interface AttendanceDeps {
  batches: BatchRepository;
  sessions: ClassSessionRepository;
  attendance: AttendanceRepository;
  enrollments: EnrollmentRepository;
  users: UserRepository;
}

/**
 * Attendance (ByteXL parity §2.9): a batch has scheduled class sessions, and a
 * trainer records each student's presence per session. A student sees their
 * overall percentage plus the session-level breakdown; a trainer sees the whole
 * cohort as a roster x sessions matrix. Reads are pure over the injected ports,
 * so the aggregates are unit-testable without a database.
 */
export class AttendanceService {
  constructor(private readonly deps: AttendanceDeps) {}

  async createSession(input: {
    batchId: string;
    tenantId: string;
    title: string;
    scheduledAt: string;
  }): Promise<ClassSessionDto | null> {
    const batch = await this.deps.batches.findById(input.batchId);
    if (!batch || batch.tenantId !== input.tenantId) return null;
    const session = await this.deps.sessions.create({
      batchId: input.batchId,
      title: input.title,
      scheduledAt: new Date(input.scheduledAt),
    });
    return toSessionDto(session);
  }

  /** A batch's sessions, oldest first, scoped to the tenant. */
  async listSessions(
    batchId: string,
    tenantId: string,
  ): Promise<ClassSessionDto[] | null> {
    const batch = await this.deps.batches.findById(batchId);
    if (!batch || batch.tenantId !== tenantId) return null;
    const sessions = await this.deps.sessions.listByBatch(batchId);
    return sessions.map(toSessionDto);
  }

  /**
   * Record or correct one student's attendance at a session. Rejects a session
   * outside the tenant and a status outside the allowed set, so a stray value
   * cannot land in the record.
   */
  async mark(input: {
    sessionId: string;
    tenantId: string;
    userId: string;
    status: string;
    markedBy?: string | null;
  }): Promise<{ ok: true } | { ok: false; reason: 'session_not_found' | 'invalid_status' }> {
    if (!isStatus(input.status)) return { ok: false, reason: 'invalid_status' };
    const session = await this.deps.sessions.findById(input.sessionId);
    if (!session) return { ok: false, reason: 'session_not_found' };
    const batch = await this.deps.batches.findById(session.batchId);
    if (!batch || batch.tenantId !== input.tenantId) {
      return { ok: false, reason: 'session_not_found' };
    }
    await this.deps.attendance.mark({
      sessionId: input.sessionId,
      userId: input.userId,
      status: input.status,
      markedBy: input.markedBy ?? null,
    });
    return { ok: true };
  }

  /**
   * The student's own attendance across every batch they belong to: the overall
   * percentage and the session-level list. Sessions they have no record for read
   * as 'not_marked' and are excluded from the percentage.
   */
  async studentView(userId: string, tenantId: string): Promise<StudentAttendanceView> {
    const enrollments = await this.deps.enrollments.listByUser(userId);
    const batchIds = [
      ...new Set(enrollments.map((e) => e.batchId).filter((b): b is string => !!b)),
    ];

    const sessions = (
      await Promise.all(batchIds.map((batchId) => this.tenantSessions(batchId, tenantId)))
    ).flat();
    sessions.sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());

    const records = await this.deps.attendance.listByUser(userId);
    const bySession = new Map(records.map((r) => [r.sessionId, r.status]));

    const sessionDtos: SessionAttendanceDto[] = sessions.map((s) => ({
      sessionId: s.id,
      title: s.title,
      scheduledAt: s.scheduledAt.toISOString(),
      status: toCellStatus(bySession.get(s.id)),
    }));

    return {
      overall: summarize(sessionDtos.map((s) => s.status)),
      sessions: sessionDtos,
    };
  }

  /** The trainer's cohort view: a roster x sessions matrix with per-student %. */
  async batchView(
    batchId: string,
    tenantId: string,
  ): Promise<BatchAttendanceDto | null> {
    const batch = await this.deps.batches.findById(batchId);
    if (!batch || batch.tenantId !== tenantId) return null;

    const sessions = await this.deps.sessions.listByBatch(batchId);
    const enrollments = await this.deps.enrollments.listByBatch(batchId);
    const userIds = [...new Set(enrollments.map((e) => e.userId))];
    const records = await this.deps.attendance.listBySessions(sessions.map((s) => s.id));
    const byUser = new Map<string, Map<string, string>>();
    for (const r of records) {
      const inner = byUser.get(r.userId) ?? new Map<string, string>();
      inner.set(r.sessionId, r.status);
      byUser.set(r.userId, inner);
    }

    const rows: BatchAttendanceRowDto[] = [];
    for (const userId of userIds) {
      const user = await this.deps.users.findById(userId);
      if (!user) continue;
      const marked = byUser.get(userId) ?? new Map<string, string>();
      const cells: AttendanceCellDto[] = sessions.map((s) => ({
        sessionId: s.id,
        status: toCellStatus(marked.get(s.id)),
      }));
      const summary = summarize(cells.map((c) => c.status));
      rows.push({
        userId: user.id,
        fullName: user.fullName,
        email: user.email,
        percent: summary.percent,
        counts: summary.counts,
        cells,
      });
    }

    return {
      batchId: batch.id,
      batchName: batch.name,
      sessions: sessions.map((s) => ({
        id: s.id,
        title: s.title,
        scheduledAt: s.scheduledAt.toISOString(),
      })),
      rows,
    };
  }

  /** Sessions of a batch, but only when the batch is in the tenant. */
  private async tenantSessions(batchId: string, tenantId: string) {
    const batch = await this.deps.batches.findById(batchId);
    if (!batch || batch.tenantId !== tenantId) return [];
    return this.deps.sessions.listByBatch(batchId);
  }
}

function toSessionDto(s: {
  id: string;
  batchId: string;
  title: string;
  scheduledAt: Date;
}): ClassSessionDto {
  return {
    id: s.id,
    batchId: s.batchId,
    title: s.title,
    scheduledAt: s.scheduledAt.toISOString(),
  };
}

function toCellStatus(status: string | undefined): AttendanceCellStatus {
  return status && isStatus(status) ? status : 'not_marked';
}

export function isStatus(value: string): value is AttendanceStatus {
  return (ATTENDANCE_STATUSES as readonly string[]).includes(value);
}

/**
 * present + late count as attended; excused sessions are dropped from the
 * denominator (an authorised absence is neither attended nor a shortfall), and
 * unmarked sessions are ignored so a figure never moves before marking.
 */
export function summarize(statuses: AttendanceCellStatus[]): AttendanceSummary {
  const counts: AttendanceCounts = { present: 0, absent: 0, late: 0, excused: 0, marked: 0 };
  for (const status of statuses) {
    if (status === 'not_marked') continue;
    counts[status] += 1;
    counts.marked += 1;
  }
  const denominator = counts.marked - counts.excused;
  const attended = counts.present + counts.late;
  const percent = denominator <= 0 ? 0 : Math.round((attended / denominator) * 100);
  return { percent, counts };
}
