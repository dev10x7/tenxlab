import {
  BadRequestException,
  ConflictException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  NotFoundException,
  Optional,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { SIGNATURE_HEADER, type RuntimeTier } from '@tenxlab/contracts';
import { JwtService } from '../crypto/jwt.service';
import { PartnerSsoService } from '../identity/partner-sso.service';
import { SessionService, type SessionPayload } from '../identity/session.service';
import { capabilitiesFor } from '../identity/capabilities';
import { findDemoUserByEmail } from '../identity/demo-users';
import { LabLaunchService } from '../labs/lab-launch.service';
import { UsageService } from '../labs/usage.service';
import { GradebookWebhookService } from '../gradebook/gradebook-webhook.service';
import { CatalogService } from '../catalog/catalog.service';
import {
  CourseAuthoringService,
  type WriteResult,
} from '../catalog/course-authoring.service';
import { requireCapability } from './guards';
import { BatchService } from '../batches/batch.service';
import { AttendanceService } from '../attendance/attendance.service';
import { SupportService } from '../support/support.service';
import { DashboardService } from '../dashboard/dashboard.service';
import { EditorService } from '../editor/editor.service';
import { AssessmentService } from '../assessments/assessment.service';
import { ProctoringService, isProctorEventType, buildSebConfig } from '../proctoring/proctoring.service';
import { IntegrityService, DEFAULT_SIMILARITY_THRESHOLD } from '../proctoring/integrity.service';
import { ProjectService } from '../projects/project.service';
import { ProjectCopyService } from '../projects/copy.service';
import { ProjectSubmissionService } from '../projects/project-submission.service';
import { PassportService } from '../hiring/passport.service';
import { ContestService } from '../contests/contest.service';
import { InterviewerService } from '../hiring/interviewer.service';
import { ClarityService } from '../clarity/clarity.service';
import { ReportsService } from '../insights/reports.service';
import { MentorService } from '../mentor/mentor.service';
import { FeedService } from '../social/feed.service';
import { SocialService } from '../social/social.service';
import { QuestionBankService } from '../questions/question-bank.service';
import { OrgService } from '../organizations/org.service';
import {
  QualityEvaluationService,
  WorkspaceNotFoundError,
  parseReport,
} from '../projects/quality-evaluation.service';
import { GitPublishService } from '../github/git-publish.service';
import { EXERCISE_BOOTSTRAP, EXERCISE_CHECK } from '../catalog/demo-data';
import type { Env } from '../config/env';
import {
  ASSESSMENT,
  ATTENDANCE,
  BATCH,
  CATALOG,
  COURSE_AUTHORING,
  DASHBOARD,
  EDITOR,
  ENV,
  GIT,
  GRADEBOOK,
  JWT,
  LAUNCH,
  PROCTOR,
  PROJECT,
  PROJECT_COPY,
  PROJECT_SUBMISSION,
  QUALITY,
  SESSION,
  SSO,
  SUPPORT,
  USAGE,
  PASSPORT,
  REPORTS,
  MENTOR,
  INTERVIEWER,
  FEED,
  SOCIAL,
  QUESTION_BANK,
  ORGS,
  CONTEST,
  INTEGRITY,
  CLARITY,
} from './tokens';

@Controller()
export class JwksController {
  constructor(@Inject(JWT) private readonly jwt: JwtService) {}

  @Get('.well-known/jwks.json')
  @Header('Cache-Control', 'public, max-age=300')
  jwks() {
    return this.jwt.jwks();
  }
}

@Controller('api/auth')
export class AuthController {
  constructor(@Inject(SESSION) private readonly sessions: SessionService) {}

  @Post('login')
  async login(
    @Body() body: { email?: string; password?: string },
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionPayload> {
    const user = body?.email ? findDemoUserByEmail(body.email) : null;
    if (!user || user.password !== body?.password) {
      throw new UnauthorizedException('Invalid email or password');
    }
    const payload: SessionPayload = {
      userId: user.id,
      tenantId: user.tenantId,
      role: user.role,
      displayName: user.fullName,
      capabilities: capabilitiesFor(user.role),
    };
    res.setHeader('set-cookie', this.sessions.setCookie(payload));
    return payload;
  }

  @Get('session')
  async session(@Req() req: Request): Promise<SessionPayload | null> {
    return this.sessions.fromCookieHeader(req.headers.cookie);
  }

  @Post('logout')
  @HttpCode(204)
  logout(@Res({ passthrough: true }) res: Response): void {
    res.setHeader('set-cookie', this.sessions.clearCookie());
  }
}

@Controller('api/catalog')
export class CatalogController {
  constructor(
    @Inject(CATALOG) private readonly catalog: CatalogService,
    @Inject(SESSION) private readonly sessions: SessionService,
  ) {}

  @Get('courses')
  async courses(@Req() req: Request) {
    const session = this.requireSession(req);
    return this.catalog.listCourses(session.tenantId, session.userId);
  }

  @Get('courses/:slug')
  async course(@Param('slug') slug: string, @Req() req: Request) {
    const session = this.requireSession(req);
    const course = await this.catalog.getCourse(session.tenantId, slug, session.userId);
    if (!course) throw new NotFoundException('Course not found');
    return course;
  }

  @Get('courses/:slug/lessons/:lessonId')
  async lesson(
    @Param('slug') slug: string,
    @Param('lessonId') lessonId: string,
    @Req() req: Request,
  ) {
    const session = this.requireSession(req);
    const lesson = await this.catalog.getLesson(
      session.tenantId,
      slug,
      lessonId,
      session.userId,
    );
    if (!lesson) throw new NotFoundException('Lesson not found');
    return lesson;
  }

  private requireSession(req: Request): SessionPayload {
    const session = this.sessions.fromCookieHeader(req.headers.cookie);
    if (!session) throw new UnauthorizedException('Sign in required');
    return session;
  }
}

/**
 * Course & lesson authoring. Instructors build a course as a tree of modules and
 * lessons, then publish it. Every route requires the `course:write` capability
 * and is tenant-scoped, so an instructor only ever touches their own content.
 */
@Controller('api/authoring/courses')
export class CourseAuthoringController {
  constructor(
    @Inject(COURSE_AUTHORING) private readonly authoring: CourseAuthoringService,
    @Inject(SESSION) private readonly sessions: SessionService,
  ) {}

  @Get()
  async list(@Req() req: Request) {
    return this.authoring.listCourses(this.guard(req).tenantId);
  }

  @Get(':courseId')
  async get(@Param('courseId') courseId: string, @Req() req: Request) {
    const course = await this.authoring.getCourse(this.guard(req).tenantId, courseId);
    if (!course) throw new NotFoundException('Course not found');
    return course;
  }

  @Post()
  @HttpCode(201)
  async create(
    @Body() body: { title?: string; description?: string },
    @Req() req: Request,
  ) {
    const result = await this.authoring.createCourse({
      tenantId: this.guard(req).tenantId,
      title: body?.title ?? '',
      description: body?.description,
    });
    return unwrap(result);
  }

  @Patch(':courseId')
  async update(
    @Param('courseId') courseId: string,
    @Body() body: { title?: string; description?: string; slug?: string },
    @Req() req: Request,
  ) {
    return unwrap(
      await this.authoring.updateCourse(this.guard(req).tenantId, courseId, body ?? {}),
    );
  }

  @Post(':courseId/publish')
  async publish(@Param('courseId') courseId: string, @Req() req: Request) {
    return unwrap(await this.authoring.publish(this.guard(req).tenantId, courseId));
  }

  @Post(':courseId/unpublish')
  async unpublish(@Param('courseId') courseId: string, @Req() req: Request) {
    return unwrap(await this.authoring.unpublish(this.guard(req).tenantId, courseId));
  }

  @Delete(':courseId')
  @HttpCode(204)
  async remove(@Param('courseId') courseId: string, @Req() req: Request) {
    await unwrap(await this.authoring.deleteCourse(this.guard(req).tenantId, courseId));
  }

  @Post(':courseId/modules')
  @HttpCode(201)
  async addModule(
    @Param('courseId') courseId: string,
    @Body() body: { title?: string },
    @Req() req: Request,
  ) {
    return unwrap(
      await this.authoring.addModule(this.guard(req).tenantId, courseId, body?.title ?? ''),
    );
  }

  @Patch('modules/:moduleId')
  async updateModule(
    @Param('moduleId') moduleId: string,
    @Body() body: { title?: string; position?: number },
    @Req() req: Request,
  ) {
    return unwrap(
      await this.authoring.updateModule(this.guard(req).tenantId, moduleId, body ?? {}),
    );
  }

  @Delete('modules/:moduleId')
  @HttpCode(204)
  async removeModule(@Param('moduleId') moduleId: string, @Req() req: Request) {
    await unwrap(await this.authoring.deleteModule(this.guard(req).tenantId, moduleId));
  }

  @Post('modules/:moduleId/lessons')
  @HttpCode(201)
  async addLesson(
    @Param('moduleId') moduleId: string,
    @Body()
    body: {
      title?: string;
      type?: string;
      maxScore?: number;
      exerciseSlug?: string | null;
      runtimeTier?: string | null;
      hint?: string | null;
      body?: string | null;
      assessmentId?: string | null;
    },
    @Req() req: Request,
  ) {
    return unwrap(
      await this.authoring.addLesson(this.guard(req).tenantId, moduleId, {
        title: body?.title ?? '',
        type: body?.type ?? 'reading',
        maxScore: body?.maxScore,
        exerciseSlug: body?.exerciseSlug ?? null,
        runtimeTier: body?.runtimeTier ?? null,
        hint: body?.hint ?? null,
        body: body?.body ?? null,
        assessmentId: body?.assessmentId ?? null,
      }),
    );
  }

  @Patch('lessons/:lessonId')
  async updateLesson(
    @Param('lessonId') lessonId: string,
    @Body()
    body: {
      title?: string;
      type?: string;
      position?: number;
      maxScore?: number;
      exerciseSlug?: string | null;
      runtimeTier?: string | null;
      hint?: string | null;
      body?: string | null;
      assessmentId?: string | null;
    },
    @Req() req: Request,
  ) {
    return unwrap(
      await this.authoring.updateLesson(this.guard(req).tenantId, lessonId, body ?? {}),
    );
  }

  @Delete('lessons/:lessonId')
  @HttpCode(204)
  async removeLesson(@Param('lessonId') lessonId: string, @Req() req: Request) {
    await unwrap(await this.authoring.deleteLesson(this.guard(req).tenantId, lessonId));
  }

  private guard(req: Request): SessionPayload {
    return requireCapability(this.sessions, req, 'course:write');
  }
}

/** Map a service write result onto HTTP: 404 for a missing id, 400 otherwise. */
function unwrap<T>(result: WriteResult<T>): T {
  if (result.ok) return result.value;
  if (
    result.reason === 'course_not_found' ||
    result.reason === 'module_not_found' ||
    result.reason === 'lesson_not_found'
  ) {
    throw new NotFoundException(result.message);
  }
  throw new BadRequestException(result.message);
}

@Controller('api/_callback/sso')
export class PartnerSsoController {
  constructor(@Inject(SSO) private readonly sso: PartnerSsoService) {}

  @Get('partner')
  async partner(@Req() req: Request, @Res() res: Response) {
    const token = String(req.query['token'] ?? '');
    if (!token) return res.redirect('/login?reason=invalid_signature');
    const result = await this.sso.verify(token);
    if (!result.ok) return res.redirect(`/login?reason=${result.reason}`);
    return res.redirect(`/dashboard?tenant=${result.tenantId}`);
  }
}

@Controller('api/labs')
export class LabController {
  constructor(
    @Inject(LAUNCH) private readonly launch: LabLaunchService,
    @Inject(SESSION) private readonly sessions: SessionService,
    @Inject(USAGE) private readonly usageService: UsageService,
  ) {}

  @Post('launch')
  async launchLab(@Body() body: { lessonId?: string }, @Req() req: Request) {
    const session = this.sessions.fromCookieHeader(req.headers.cookie);
    if (!session) throw new UnauthorizedException('Sign in required');
    if (!body?.lessonId) throw new BadRequestException('lessonId is required');

    const result = await this.launch.launch({
      userId: session.userId,
      tenantId: session.tenantId,
      lessonId: body.lessonId,
    });
    if (!result.ok) {
      if (result.reason === 'tenant_quota_exceeded') {
        throw new HttpException(result.message, HttpStatus.TOO_MANY_REQUESTS);
      }
      if (result.reason === 'lab_unavailable') {
        throw new HttpException(result.message, HttpStatus.SERVICE_UNAVAILABLE);
      }
      if (result.reason === 'lesson_not_found') {
        throw new NotFoundException(result.message);
      }
      if (result.reason === 'membership_required') {
        throw new ForbiddenException(result.message);
      }
      // `not_a_lab`: the lesson exists but has no launchable exercise — a bad
      // request, not an auth failure, so the client can explain it accurately.
      throw new BadRequestException(result.message);
    }
    return result;
  }

  @Get('sessions/:id')
  async session(@Param('id') id: string, @Req() req: Request) {
    const session = this.sessions.fromCookieHeader(req.headers.cookie);
    if (!session) throw new UnauthorizedException('Sign in required');
    const row = await this.launch.getSession(id);
    if (!row || row.userId !== session.userId) {
      throw new NotFoundException('Session not found');
    }
    return {
      sessionId: row.id,
      status: row.status,
      tier: row.tier,
      ideUrl: this.launch.ideUrl(row),
    };
  }

  /** Tenant cost and quota view for the current billing period. */
  @Get('usage')
  async usage(@Req() req: Request) {
    const session = this.sessions.fromCookieHeader(req.headers.cookie);
    if (!session) throw new UnauthorizedException('Sign in required');
    return this.usageService.summarize(session.tenantId);
  }
}

/**
 * Exercise scripts fetched by the KubeLab agent pod from inside the cluster.
 * Unauthenticated by design: the pod has no session, and the content is
 * non-secret teaching material.
 */
@Controller('api/labs/assets')
export class LabAssetController {
  @Get(':slug/bootstrap.sh')
  @Header('content-type', 'text/x-shellscript; charset=utf-8')
  bootstrap(@Param('slug') slug: string): string {
    const script = EXERCISE_BOOTSTRAP[slug];
    if (!script) throw new NotFoundException('Unknown exercise');
    return script;
  }

  @Get(':slug/check.sh')
  @Header('content-type', 'text/x-shellscript; charset=utf-8')
  check(@Param('slug') slug: string): string {
    const script = EXERCISE_CHECK[slug];
    if (!script) throw new NotFoundException('Unknown exercise');
    return script;
  }
}

@Controller('api/webhooks')
export class WebhookController {
  constructor(@Inject(GRADEBOOK) private readonly gradebook: GradebookWebhookService) {}

  @Post('lab')
  @HttpCode(200)
  async labWebhook(@Req() req: Request, @Res() res: Response) {
    const raw =
      (req as Request & { rawBody?: Buffer }).rawBody?.toString('utf8') ??
      JSON.stringify(req.body ?? {});
    const signature = req.header(SIGNATURE_HEADER);
    const result = await this.gradebook.handle(raw, signature);
    if (!result.ok) {
      return res.status(result.status).json({ message: result.message });
    }
    return res.json({ received: true, duplicate: result.duplicate });
  }
}

/**
 * Cohort management and the instructor gradebook. Read endpoints are open to
 * any signed-in member of the tenant; writes require instructor or admin, so a
 * student cannot create a batch or alter a roster.
 */
@Controller('api/batches')
export class BatchesController {
  constructor(
    @Inject(BATCH) private readonly batches: BatchService,
    @Inject(SESSION) private readonly sessions: SessionService,
  ) {}

  @Get()
  async list(@Req() req: Request) {
    return this.batches.listBatches(this.requireSession(req).tenantId);
  }

  @Post()
  async create(@Body() body: { name?: string }, @Req() req: Request) {
    const session = this.requireInstructor(req);
    const name = body?.name?.trim();
    if (!name) throw new BadRequestException('name is required');
    return this.batches.createBatch({ tenantId: session.tenantId, name });
  }

  /** Students of the tenant, for the assignment picker. */
  @Get('students')
  async students(@Req() req: Request) {
    return this.batches.listStudents(this.requireSession(req).tenantId);
  }

  @Get(':id/roster')
  async roster(@Param('id') id: string, @Req() req: Request) {
    const roster = await this.batches.roster(id, this.requireSession(req).tenantId);
    if (!roster) throw new NotFoundException('Batch not found');
    return roster;
  }

  @Get(':id/gradebook')
  async gradebook(@Param('id') id: string, @Req() req: Request) {
    const gradebook = await this.batches.gradebook(
      id,
      this.requireInstructor(req).tenantId,
    );
    if (!gradebook) throw new NotFoundException('Batch not found');
    return gradebook;
  }

  @Post(':id/students')
  @HttpCode(201)
  async assign(
    @Param('id') id: string,
    @Body() body: { userId?: string; courseId?: string },
    @Req() req: Request,
  ) {
    const session = this.requireInstructor(req);
    if (!body?.userId) throw new BadRequestException('userId is required');
    if (!body?.courseId) throw new BadRequestException('courseId is required');
    const result = await this.batches.assign({
      batchId: id,
      userId: body.userId,
      courseId: body.courseId,
      tenantId: session.tenantId,
    });
    if (!result.ok) {
      if (result.reason === 'batch_not_found') {
        throw new NotFoundException('Batch not found');
      }
      throw new BadRequestException('Only students of this institution can be assigned');
    }
    return { ok: true };
  }

  private requireSession(req: Request): SessionPayload {
    const session = this.sessions.fromCookieHeader(req.headers.cookie);
    if (!session) throw new UnauthorizedException('Sign in required');
    return session;
  }

  private requireInstructor(req: Request): SessionPayload {
    const session = this.requireSession(req);
    if (session.role !== 'instructor' && session.role !== 'admin') {
      throw new ForbiddenException('Instructor or admin role required');
    }
    return session;
  }
}

/**
 * Attendance (ByteXL parity §2.9): a student reads their own overall +
 * session-level attendance; a trainer reads the cohort matrix and records
 * presence. Reads are open to any signed-in tenant member; every write requires
 * instructor or admin, so a student cannot mark attendance.
 */
@Controller('api/attendance')
export class AttendanceController {
  constructor(
    @Inject(ATTENDANCE) private readonly attendance: AttendanceService,
    @Inject(SESSION) private readonly sessions: SessionService,
  ) {}

  /** The caller's own attendance, as a student. */
  @Get('me')
  async me(@Req() req: Request) {
    const session = this.requireSession(req);
    return this.attendance.studentView(session.userId, session.tenantId);
  }

  /** A batch's scheduled sessions, oldest first. */
  @Get('batches/:id/sessions')
  async listSessions(@Param('id') id: string, @Req() req: Request) {
    const list = await this.attendance.listSessions(id, this.requireSession(req).tenantId);
    if (!list) throw new NotFoundException('Batch not found');
    return list;
  }

  @Post('batches/:id/sessions')
  @HttpCode(201)
  async createSession(
    @Param('id') id: string,
    @Body() body: { title?: string; scheduledAt?: string },
    @Req() req: Request,
  ) {
    const session = this.requireInstructor(req);
    const title = body?.title?.trim();
    if (!title) throw new BadRequestException('title is required');
    const scheduledAt = body?.scheduledAt;
    if (!scheduledAt || Number.isNaN(Date.parse(scheduledAt))) {
      throw new BadRequestException('scheduledAt must be an ISO date');
    }
    const created = await this.attendance.createSession({
      batchId: id,
      tenantId: session.tenantId,
      title,
      scheduledAt,
    });
    if (!created) throw new NotFoundException('Batch not found');
    return created;
  }

  /** The trainer's cohort matrix: roster x sessions with per-student %. */
  @Get('batches/:id')
  async batch(@Param('id') id: string, @Req() req: Request) {
    const view = await this.attendance.batchView(id, this.requireInstructor(req).tenantId);
    if (!view) throw new NotFoundException('Batch not found');
    return view;
  }

  /** Record or correct one student's attendance at a session. */
  @Patch('sessions/:sessionId')
  async mark(
    @Param('sessionId') sessionId: string,
    @Body() body: { userId?: string; status?: string },
    @Req() req: Request,
  ) {
    const session = this.requireInstructor(req);
    if (!body?.userId) throw new BadRequestException('userId is required');
    if (!body?.status) throw new BadRequestException('status is required');
    const result = await this.attendance.mark({
      sessionId,
      tenantId: session.tenantId,
      userId: body.userId,
      status: body.status,
      markedBy: session.userId,
    });
    if (!result.ok) {
      if (result.reason === 'invalid_status') {
        throw new BadRequestException('Unknown attendance status');
      }
      throw new NotFoundException('Session not found');
    }
    return { ok: true };
  }

  private requireSession(req: Request): SessionPayload {
    const session = this.sessions.fromCookieHeader(req.headers.cookie);
    if (!session) throw new UnauthorizedException('Sign in required');
    return session;
  }

  private requireInstructor(req: Request): SessionPayload {
    const session = this.requireSession(req);
    if (session.role !== 'instructor' && session.role !== 'admin') {
      throw new ForbiddenException('Instructor or admin role required');
    }
    return session;
  }
}

/**
 * The Editor surface: a single-pane practice playground. Run is stateless and
 * backed by the tier-1 execution pool; snippets are private to their author
 * (every read and write is scoped by the session's userId).
 */
@Controller('api/editor')
export class EditorController {
  constructor(
    @Inject(EDITOR) private readonly editor: EditorService,
    @Inject(SESSION) private readonly sessions: SessionService,
  ) {}

  @Get('languages')
  languages() {
    return this.editor.languages();
  }

  @Post('run')
  async run(
    @Body() body: { language?: string; source?: string; stdin?: string },
    @Req() req: Request,
  ) {
    this.requireSession(req);
    if (!body?.language) throw new BadRequestException('language is required');
    if (typeof body.source !== 'string') {
      throw new BadRequestException('source is required');
    }
    const outcome = await this.editor.run({
      language: body.language,
      source: body.source,
      stdin: body.stdin ?? '',
    });
    if (!outcome.ok) {
      if (outcome.reason === 'unknown_language') {
        throw new BadRequestException('Unknown language');
      }
      throw new HttpException(
        'Code execution is not available',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return outcome.result;
  }

  @Get('snippets')
  async listSnippets(@Req() req: Request) {
    return this.editor.listSnippets(this.requireSession(req).userId);
  }

  @Post('snippets')
  @HttpCode(201)
  async saveSnippet(
    @Body()
    body: { language?: string; title?: string; source?: string; stdin?: string },
    @Req() req: Request,
  ) {
    const session = this.requireSession(req);
    if (typeof body?.source !== 'string') {
      throw new BadRequestException('source is required');
    }
    return this.editor.saveSnippet({
      userId: session.userId,
      language: body.language ?? 'python',
      title: body.title ?? 'Untitled',
      source: body.source,
      stdin: body.stdin ?? '',
    });
  }

  @Get('snippets/:id')
  async getSnippet(@Param('id') id: string, @Req() req: Request) {
    const snippet = await this.editor.getSnippet(id, this.requireSession(req).userId);
    if (!snippet) throw new NotFoundException('Snippet not found');
    return snippet;
  }

  @Patch('snippets/:id')
  async updateSnippet(
    @Param('id') id: string,
    @Body()
    body: { language?: string; title?: string; source?: string; stdin?: string },
    @Req() req: Request,
  ) {
    const snippet = await this.editor.updateSnippet(
      id,
      this.requireSession(req).userId,
      body ?? {},
    );
    if (!snippet) throw new NotFoundException('Snippet not found');
    return snippet;
  }

  @Delete('snippets/:id')
  @HttpCode(204)
  async deleteSnippet(@Param('id') id: string, @Req() req: Request): Promise<void> {
    const ok = await this.editor.deleteSnippet(id, this.requireSession(req).userId);
    if (!ok) throw new NotFoundException('Snippet not found');
  }

  /**
   * Ask the AI tutor about the buffer. Defaults to `assist` (the practice-editor
   * mode that may return corrected code); `socratic` is available for callers
   * that must not receive a solution.
   */
  @Post('review')
  async review(
    @Body()
    body: { language?: string; source?: string; mode?: string; stderr?: string },
    @Req() req: Request,
  ) {
    this.requireSession(req);
    if (!body?.language) throw new BadRequestException('language is required');
    if (typeof body.source !== 'string') {
      throw new BadRequestException('source is required');
    }
    if (body.mode !== undefined && body.mode !== 'assist' && body.mode !== 'socratic') {
      throw new BadRequestException('mode must be "assist" or "socratic"');
    }
    const outcome = await this.editor.review({
      language: body.language,
      source: body.source,
      mode: body.mode,
      stderr: body.stderr,
    });
    if (!outcome.ok) {
      if (outcome.reason === 'unknown_language') {
        throw new BadRequestException('Unknown language');
      }
      throw new HttpException(
        'AI review is not available',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return outcome.report;
  }

  private requireSession(req: Request): SessionPayload {
    const session = this.sessions.fromCookieHeader(req.headers.cookie);
    if (!session) throw new UnauthorizedException('Sign in required');
    return session;
  }
}

/**
 * The Assessment surface: list assessments, start/resume an attempt, and submit
 * for grading. The server owns the exam clock; a late submission is recorded but
 * marked expired. Coding questions run on the tier-1 pool and enforce the
 * read-only region of the stub before grading.
 */
@Controller('api/assessments')
export class AssessmentController {
  constructor(
    @Inject(ASSESSMENT) private readonly assessments: AssessmentService,
    @Inject(SESSION) private readonly sessions: SessionService,
    @Optional() @Inject(ENV) private readonly env?: Env,
  ) {}

  @Get()
  async list(@Req() req: Request) {
    this.requireSession(req);
    return this.assessments.listAll();
  }

  @Get('attempts')
  async history(@Req() req: Request) {
    return this.assessments.history(this.requireSession(req).userId);
  }

  @Get(':id')
  async get(@Param('id') id: string, @Req() req: Request) {
    this.requireSession(req);
    const assessment = this.assessments.getAssessment(id);
    if (!assessment) throw new NotFoundException('Assessment not found');
    return assessment;
  }

  /**
   * Download the Safe Exam Browser configuration for a proctored assessment
   * (ByteXL parity §2.8). SEB opens straight at the exam URL; the config is
   * only served to a signed-in session, and a non-proctored assessment has no
   * locked-down config to hand out.
   */
  @Get(':id/seb')
  async seb(
    @Param('id') id: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    this.requireSession(req);
    const assessment = this.assessments.getAssessment(id);
    if (!assessment) throw new NotFoundException('Assessment not found');
    if (!assessment.proctored) {
      throw new BadRequestException('This assessment is not proctored');
    }
    const config = buildSebConfig({
      startUrl: `${this.webBaseUrl()}/assessments/${encodeURIComponent(id)}`,
    });
    res.setHeader('content-type', 'application/seb');
    res.setHeader(
      'content-disposition',
      `attachment; filename="${id}.seb"`,
    );
    res.end(JSON.stringify(config));
  }

  /** Browser-facing origin the exam runs on; falls back to the API origin. */
  private webBaseUrl(): string {
    return (this.env?.WEB_PUBLIC_URL ?? this.env?.API_PUBLIC_URL ?? '').replace(
      /\/$/,
      '',
    );
  }

  @Post(':id/attempts')
  @HttpCode(201)
  async start(
    @Param('id') id: string,
    @Body() body: { passcode?: string },
    @Req() req: Request,
  ) {
    const result = await this.assessments.startAttempt(
      this.requireSession(req).userId,
      id,
      undefined,
      body?.passcode,
    );
    if (!result.ok) {
      if (result.reason === 'passcode_required') {
        throw new ForbiddenException('A valid start passcode is required');
      }
      throw new NotFoundException('Assessment not found');
    }
    return result.attempt;
  }

  @Get('attempts/:attemptId')
  async attempt(@Param('attemptId') attemptId: string, @Req() req: Request) {
    const attempt = await this.assessments.getAttempt(
      attemptId,
      this.requireSession(req).userId,
    );
    if (!attempt) throw new NotFoundException('Attempt not found');
    return attempt;
  }

  @Post('attempts/:attemptId/submit')
  async submit(
    @Param('attemptId') attemptId: string,
    @Body() body: { answers?: Record<string, unknown> },
    @Req() req: Request,
  ) {
    const session = this.requireSession(req);
    const result = await this.assessments.submit(
      attemptId,
      session.userId,
      body?.answers ?? {},
    );
    if ('reason' in result) {
      if (result.reason === 'not_found') throw new NotFoundException('Attempt not found');
      throw new BadRequestException(
        result.reason === 'expired'
          ? 'This attempt has expired'
          : 'This attempt has already been submitted',
      );
    }
    return result;
  }

  private requireSession(req: Request): SessionPayload {
    const session = this.sessions.fromCookieHeader(req.headers.cookie);
    if (!session) throw new UnauthorizedException('Sign in required');
    return session;
  }
}

/**
 * Proctoring ingest and review. Students POST the client-reported signals their
 * browser captures during a graded attempt; instructors read the aggregated risk
 * summary. Events are advisory — never proof of cheating.
 */
@Controller('api/proctoring')
export class ProctoringController {
  constructor(
    @Inject(PROCTOR) private readonly proctoring: ProctoringService,
    @Inject(INTEGRITY) private readonly integrity: IntegrityService,
    @Inject(ASSESSMENT) private readonly assessments: AssessmentService,
    @Inject(SESSION) private readonly sessions: SessionService,
  ) {}

  @Post('attempts/:attemptId/events')
  @HttpCode(202)
  async record(
    @Param('attemptId') attemptId: string,
    @Body() body: { type?: string; detail?: string },
    @Req() req: Request,
  ) {
    const session = this.requireSession(req);
    // Only the owner of the attempt may report events for it.
    const attempt = await this.assessments.getAttempt(attemptId, session.userId);
    if (!attempt) throw new NotFoundException('Attempt not found');
    if (!isProctorEventType(body?.type)) {
      throw new BadRequestException('Unknown proctoring event type');
    }
    await this.proctoring.record(attemptId, body.type, body.detail);
    return { received: true };
  }

  @Get('attempts')
  async list(@Req() req: Request) {
    const session = this.requireInstructor(req);
    const attempts = await this.assessments.reviewForTenant(session.tenantId);
    const summaries = await this.proctoring.summarizeMany(attempts.map((a) => a.id));
    const byId = new Map(summaries.map((s) => [s.attemptId, s]));
    return attempts.map((a) => ({
      attemptId: a.id,
      assessmentId: a.assessmentId,
      status: a.status,
      score: a.score,
      startedAt: a.startedAt.toISOString(),
      risk: byId.get(a.id) ?? {
        attemptId: a.id,
        eventCount: 0,
        riskScore: 0,
        riskLevel: 'low' as const,
        counts: {},
      },
    }));
  }

  @Get('attempts/:attemptId/summary')
  async summary(@Param('attemptId') attemptId: string, @Req() req: Request) {
    const session = this.requireInstructor(req);
    const attempt = await this.assessments.getAttemptForTenantReview(
      attemptId,
      session.tenantId,
    );
    if (!attempt) throw new NotFoundException('Attempt not found');
    return this.proctoring.summarize(attemptId);
  }

  /**
   * Batch-scope code-similarity scan for one graded assessment (§4.2). Advisory:
   * it reports candidate matches, never a verdict. Instructor-triggered because
   * the comparison is O(n²) in the cohort.
   */
  @Get('assessments/:assessmentId/similarity')
  async similarity(
    @Param('assessmentId') assessmentId: string,
    @Query('threshold') threshold: string | undefined,
    @Req() req: Request,
  ) {
    const session = this.requireInstructor(req);
    if (!this.integrity.available) {
      throw new ServiceUnavailableException(
        'Code-similarity scanning is not configured (AI plane unavailable)',
      );
    }
    return this.integrity.scanAssessment(
      assessmentId,
      session.tenantId,
      numberOrUndefined(threshold) ?? DEFAULT_SIMILARITY_THRESHOLD,
    );
  }

  private requireSession(req: Request): SessionPayload {
    const session = this.sessions.fromCookieHeader(req.headers.cookie);
    if (!session) throw new UnauthorizedException('Sign in required');
    return session;
  }

  private requireInstructor(req: Request): SessionPayload {
    const session = this.requireSession(req);
    if (session.role !== 'instructor' && session.role !== 'admin') {
      throw new ForbiddenException('Instructor or admin role required');
    }
    return session;
  }
}

/**
 * Projects (the ByteXL "Nimbus" equivalent): students fork a project's template
 * into a durable cloud workspace, build in an online VS Code, stop the
 * workspace, and submit it with optional GitHub/demo links; instructors author
 * and publish projects and evaluate submissions.
 *
 * Student reads are scoped to published projects and the caller's own forks;
 * authoring and evaluation require instructor or admin. A fork is asynchronous —
 * the client polls the fork endpoint until the workspace reports `running`.
 */
@Controller('api/projects')
export class ProjectsController {
  constructor(
    @Inject(PROJECT) private readonly projects: ProjectService,
    @Inject(PROJECT_COPY) private readonly copy: ProjectCopyService,
    @Inject(PROJECT_SUBMISSION) private readonly submissions: ProjectSubmissionService,
    @Inject(QUALITY) private readonly quality: QualityEvaluationService,
    @Inject(SESSION) private readonly sessions: SessionService,
  ) {}

  /**
   * Suggest a project title/description from the facts the author already has
   * (§2.11, ByteXL's "clear and catchy name"). Deterministic and offline
   * (ADR-13); when the AI plane is unconfigured the caller keeps its own text.
   * Open to any signed-in user: an instructor drafts a project name, a student
   * drafts a submission title.
   */
  @Post('suggest-copy')
  async suggestCopy(
    @Body()
    body: { hint?: string; stacks?: string[]; componentTitles?: string[] },
    @Req() req: Request,
  ) {
    this.requireSession(req);
    const result = await this.copy.suggest({
      hint: body?.hint,
      stacks: body?.stacks,
      componentTitles: body?.componentTitles,
    });
    if (!result.ok) {
      throw new HttpException(
        'Copy suggestions are not available in this deployment',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    return result.suggestion;
  }

  /** The template catalog, for the instructor authoring form. */
  @Get('templates')
  templates(@Req() req: Request) {
    this.requireInstructor(req);
    return this.projects.listTemplates();
  }

  /** A student's own submissions, newest first. Declared before `:id` so the
   * literal path is not swallowed by the parameter route. */
  @Get('submissions')
  async mySubmissions(@Req() req: Request) {
    const session = this.requireSession(req);
    return this.submissions.listForStudent(session.tenantId, session.userId);
  }

  /** Poll a fork's workspace status until it reports `running` and an IDE URL. */
  @Get('forks/:forkId')
  async forkStatus(@Param('forkId') forkId: string, @Req() req: Request) {
    const session = this.requireSession(req);
    const status = await this.projects.getForkStatus(forkId);
    if (!status || status.fork.userId !== session.userId) {
      throw new NotFoundException('Fork not found');
    }
    return {
      forkId: status.fork.id,
      workspaceId: status.fork.workspaceId,
      componentId: status.fork.componentId,
      projectId: status.fork.projectId,
      status: status.workspace?.status ?? 'stopped',
      tier: status.workspace?.runtimeTier ?? null,
      ideUrl: status.workspace ? this.projects.ideUrlFor(status.workspace) : null,
      deployUrl: status.workspace?.deployUrl ?? null,
      deployPort: status.workspace?.deployPort ?? null,
      qualityScore: status.workspace?.qualityScore ?? null,
      analyzedAt: status.workspace?.analyzedAt ?? null,
    };
  }

  /**
   * Auto-evaluate (E4): run the AI plane's quality analyzer against the
   * caller's running workspace. Returns the score, the explainable issues, and
   * records the run on the workspace.
   */
  @Post('workspaces/:workspaceId/analyze')
  async analyzeWorkspace(
    @Param('workspaceId') workspaceId: string,
    @Req() req: Request,
  ) {
    const session = this.requireSession(req);
    const result = await this.quality.analyze(session.userId, workspaceId);
    if (!result.ok) {
      if (result.reason === 'workspace_not_found') {
        throw new NotFoundException(result.message);
      }
      if (result.reason === 'workspace_not_running') {
        throw new HttpException(result.message, HttpStatus.CONFLICT);
      }
      // analysis_unavailable / analysis_failed
      throw new HttpException(result.message, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return {
      workspaceId,
      score: result.evaluation.score,
      issueCount: result.evaluation.issueCount,
      issues: result.report?.issues ?? [],
      analyzedAt: result.evaluation.createdAt,
    };
  }

  /** A workspace's auto-evaluation history, newest first. */
  @Get('workspaces/:workspaceId/evaluations')
  async workspaceEvaluations(
    @Param('workspaceId') workspaceId: string,
    @Req() req: Request,
  ) {
    const session = this.requireSession(req);
    let history;
    try {
      history = await this.quality.history(session.userId, workspaceId);
    } catch (err) {
      if (err instanceof WorkspaceNotFoundError) {
        throw new NotFoundException(err.message);
      }
      throw err;
    }
    return history.map((e) => ({
      id: e.id,
      score: e.score,
      issueCount: e.issueCount,
      status: e.status,
      error: e.error,
      report: parseReport(e.report),
      createdAt: e.createdAt,
    }));
  }

  /** Published projects for the signed-in student, with their fork state. */
  @Get()
  async list(@Req() req: Request) {
    const session = this.requireSession(req);
    if (session.role === 'student') {
      return this.projects.listForStudent(session.tenantId, session.userId);
    }
    return this.projects.listForInstructor(session.tenantId);
  }

  @Get(':id')
  async detail(@Param('id') id: string, @Req() req: Request) {
    const session = this.requireSession(req);
    if (session.role === 'student') {
      const view = await this.projects.getForStudent(session.tenantId, session.userId, id);
      if (!view) throw new NotFoundException('Project not found');
      return view;
    }
    const all = await this.projects.listForInstructor(session.tenantId);
    const view = all.find((p) => p.project.id === id);
    if (!view) throw new NotFoundException('Project not found');
    return view;
  }

  /** Fork a component into the student's own durable workspace. */
  @Post(':id/components/:componentId/fork')
  @HttpCode(201)
  async fork(
    @Param('id') projectId: string,
    @Param('componentId') componentId: string,
    @Req() req: Request,
  ) {
    const session = this.requireSession(req);
    const result = await this.projects.fork({
      userId: session.userId,
      tenantId: session.tenantId,
      projectId,
      componentId,
    });
    if (!result.ok) {
      if (result.reason === 'project_not_found' || result.reason === 'component_not_found') {
        throw new NotFoundException(result.message);
      }
      if (result.reason === 'membership_required') {
        throw new ForbiddenException(result.message);
      }
      if (result.reason === 'storage_exceeded') {
        // The tenant is over its fork-storage ceiling (ADR-20): a conflict with
        // the current plan, not a malformed request.
        throw new ConflictException(result.message);
      }
      throw new BadRequestException(result.message);
    }
    return result;
  }

  /** Stop a fork's workspace (required before submit). */
  @Post('workspaces/:workspaceId/stop')
  async stopWorkspace(@Param('workspaceId') workspaceId: string, @Req() req: Request) {
    const session = this.requireSession(req);
    const result = await this.projects.stopWorkspace(session.userId, workspaceId);
    if (!result.ok) throw new NotFoundException(result.message);
    return {
      workspaceId: result.workspace.id,
      status: result.workspace.status,
    };
  }

  /**
   * Deploy (E5): expose the running workspace's service on a public URL.
   * The student names the port their app listens on; the URL is what they submit
   * as a demo link.
   */
  @Post('workspaces/:workspaceId/deploy')
  async deployWorkspace(
    @Param('workspaceId') workspaceId: string,
    @Body() body: { port?: number },
    @Req() req: Request,
  ) {
    const session = this.requireSession(req);
    const port = Number(body?.port);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      throw new BadRequestException('port must be a TCP port between 1 and 65535');
    }
    const result = await this.projects.deploy(session.userId, workspaceId, port);
    if (!result.ok) {
      if (result.reason === 'workspace_not_found') {
        throw new NotFoundException(result.message);
      }
      if (result.reason === 'workspace_not_running') {
        throw new HttpException(result.message, HttpStatus.CONFLICT);
      }
      // deploy_unavailable / deploy_failed
      throw new HttpException(result.message, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return {
      workspaceId: result.workspace.id,
      deployUrl: result.workspace.deployUrl,
      deployPort: result.workspace.deployPort,
    };
  }

  /** Withdraw a workspace's exposed service. */
  @Delete('workspaces/:workspaceId/deploy')
  async undeployWorkspace(
    @Param('workspaceId') workspaceId: string,
    @Req() req: Request,
  ) {
    const session = this.requireSession(req);
    const result = await this.projects.undeploy(session.userId, workspaceId);
    if (!result.ok) throw new NotFoundException(result.message);
    return {
      workspaceId: result.workspace.id,
      deployUrl: result.workspace.deployUrl,
      deployPort: result.workspace.deployPort,
    };
  }

  /**
   * Download a workspace's files as a gzipped tar (ByteXL's "download
   * workspace" quick action, Nov'25 §1.5). The workspace must be running.
   */
  @Get('workspaces/:workspaceId/download')
  async downloadWorkspace(
    @Param('workspaceId') workspaceId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const session = this.requireSession(req);
    const result = await this.projects.download(session.userId, workspaceId);
    if (!result.ok) {
      if (result.reason === 'workspace_not_found') {
        throw new NotFoundException(result.message);
      }
      if (result.reason === 'workspace_not_running') {
        throw new HttpException(result.message, HttpStatus.CONFLICT);
      }
      // download_unavailable / download_empty / download_failed
      throw new HttpException(
        result.message,
        result.reason === 'download_empty'
          ? HttpStatus.CONFLICT
          : HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    res.setHeader('content-type', 'application/gzip');
    res.setHeader(
      'content-disposition',
      `attachment; filename="workspace-${workspaceId}.tar.gz"`,
    );
    res.end(Buffer.from(result.archive));
  }

  /**
   * Delete a workspace and its fork (ByteXL's "delete" quick action, Nov'25
   * §1.5). Destructive: the compute is terminated and the volume released, so
   * the component becomes forkable again.
   */
  @Delete('workspaces/:workspaceId')
  async deleteWorkspace(
    @Param('workspaceId') workspaceId: string,
    @Req() req: Request,
  ) {
    const session = this.requireSession(req);
    const result = await this.projects.deleteWorkspace(session.userId, workspaceId);
    if (!result.ok) throw new NotFoundException(result.message);
    return { workspaceId: result.workspaceId, deleted: true };
  }

  /** Submit a stopped workspace for a project component. */
  @Post(':id/components/:componentId/submissions')
  @HttpCode(201)
  async submit(
    @Param('id') projectId: string,
    @Param('componentId') componentId: string,
    @Body()
    body: {
      workspaceId?: string;
      title?: string;
      description?: string;
      githubUrl?: string | null;
      demoUrl?: string | null;
    },
    @Req() req: Request,
  ) {
    const session = this.requireSession(req);
    if (!body?.workspaceId) throw new BadRequestException('workspaceId is required');
    const title = body.title?.trim();
    if (!title) throw new BadRequestException('title is required');

    const result = await this.submissions.submit({
      userId: session.userId,
      tenantId: session.tenantId,
      projectId,
      componentId,
      workspaceId: body.workspaceId,
      title,
      description: body.description ?? '',
      githubUrl: body.githubUrl ?? null,
      demoUrl: body.demoUrl ?? null,
    });
    if (!result.ok) {
      if (result.reason === 'project_not_found' || result.reason === 'component_not_found') {
        throw new NotFoundException(result.message);
      }
      if (result.reason === 'membership_required' || result.reason === 'fork_required') {
        throw new ForbiddenException(result.message);
      }
      // deadline_passed / workspace_active / workspace_not_ready are conflicts.
      throw new HttpException(result.message, HttpStatus.CONFLICT);
    }
    return result.submission;
  }

  /** The instructor evaluation queue for a project. */
  @Get(':id/submissions')
  async projectSubmissions(@Param('id') projectId: string, @Req() req: Request) {
    const session = this.requireInstructor(req);
    return this.submissions.listForProject(session.tenantId, projectId);
  }

  /** Record a trainer's score and feedback against a submission. */
  @Patch('submissions/:submissionId')
  async evaluate(
    @Param('submissionId') submissionId: string,
    @Body() body: { score?: number; feedback?: string | null },
    @Req() req: Request,
  ) {
    const session = this.requireInstructor(req);
    if (typeof body?.score !== 'number') {
      throw new BadRequestException('score is required');
    }
    const result = await this.submissions.evaluate(session.tenantId, submissionId, {
      score: body.score,
      feedback: body.feedback ?? null,
    });
    if (!result.ok) {
      if (result.reason === 'submission_not_found') {
        throw new NotFoundException(result.message);
      }
      throw new BadRequestException(result.message);
    }
    return result.submission;
  }

  /** Author a new project (draft until published). */
  @Post()
  @HttpCode(201)
  async create(
    @Body()
    body: {
      title?: string;
      description?: string;
      runtimeTier?: RuntimeTier;
      deadline?: string | null;
      maxScore?: number;
    },
    @Req() req: Request,
  ) {
    const session = this.requireInstructor(req);
    const result = await this.projects.createProject({
      tenantId: session.tenantId,
      title: body?.title ?? '',
      description: body?.description,
      runtimeTier: body?.runtimeTier,
      deadline: body?.deadline ?? null,
      maxScore: body?.maxScore,
    });
    if (!result.ok) throw new BadRequestException(result.message);
    return result.project;
  }

  /** Add a technology slot to a project. */
  @Post(':id/components')
  @HttpCode(201)
  async addComponent(
    @Param('id') projectId: string,
    @Body()
    body: {
      title?: string;
      technology?: string;
      templateSlug?: string | null;
      templateWorkspaceId?: string | null;
      position?: number;
    },
    @Req() req: Request,
  ) {
    const session = this.requireInstructor(req);
    const result = await this.projects.addComponent(session.tenantId, projectId, {
      tenantId: session.tenantId,
      title: body?.title ?? '',
      technology: body?.technology ?? '',
      templateSlug: body?.templateSlug ?? null,
      templateWorkspaceId: body?.templateWorkspaceId ?? null,
      position: body?.position,
    });
    if (!result.ok) {
      if (result.reason === 'project_not_found') {
        throw new NotFoundException(result.message);
      }
      throw new BadRequestException(result.message);
    }
    return result.component;
  }

  /** Publish a project so students can see and fork it. */
  @Post(':id/publish')
  async publish(@Param('id') projectId: string, @Req() req: Request) {
    const session = this.requireInstructor(req);
    const result = await this.projects.publish(session.tenantId, projectId);
    if (!result.ok) throw new NotFoundException(result.message);
    return result.project;
  }

  private requireSession(req: Request): SessionPayload {
    const session = this.sessions.fromCookieHeader(req.headers.cookie);
    if (!session) throw new UnauthorizedException('Sign in required');
    return session;
  }

  private requireInstructor(req: Request): SessionPayload {
    const session = this.requireSession(req);
    if (session.role !== 'instructor' && session.role !== 'admin') {
      throw new ForbiddenException('Instructor or admin role required');
    }
    return session;
  }
}

/**
 * Git publish — ByteXL's IDE Source Control push. A student connects their
 * GitHub account once (OAuth device flow), then publishes a running workspace
 * to a repo on their own account. Every route is scoped to the caller.
 */
@Controller('api/git')
export class GitController {
  constructor(
    @Inject(GIT) private readonly git: GitPublishService,
    @Inject(SESSION) private readonly sessions: SessionService,
  ) {}

  /** The caller's GitHub connection state. */
  @Get('status')
  status(@Req() req: Request) {
    const session = this.requireSession(req);
    return this.git.status(session.userId);
  }

  /** Begin a device-flow connection; returns the user code to type at GitHub. */
  @Post('connect/start')
  async connectStart(@Req() req: Request) {
    this.requireSession(req);
    const result = await this.git.connectStart();
    if (!result.ok) {
      throw new HttpException(result.message, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return result.grant;
  }

  /** Finish a device-flow connection once the student approved the code. */
  @Post('connect/complete')
  async connectComplete(@Body() body: { deviceCode?: string }, @Req() req: Request) {
    const session = this.requireSession(req);
    if (!body?.deviceCode) throw new BadRequestException('deviceCode is required');
    const result = await this.git.connectComplete(
      session.userId,
      session.tenantId,
      body.deviceCode,
    );
    if (!result.ok) {
      if (result.reason === 'authorization_pending') {
        throw new HttpException(result.message, HttpStatus.ACCEPTED);
      }
      throw new BadRequestException(result.message);
    }
    return result.connection;
  }

  /** Disconnect the caller's GitHub account. */
  @Delete('connect')
  async disconnect(@Req() req: Request) {
    const session = this.requireSession(req);
    await this.git.disconnect(session.userId);
    return { connected: false };
  }

  /** Publish a running workspace to the student's GitHub. */
  @Post('workspaces/:workspaceId/publish')
  async publish(
    @Param('workspaceId') workspaceId: string,
    @Body() body: { repoName?: string; branch?: string },
    @Req() req: Request,
  ) {
    const session = this.requireSession(req);
    const result = await this.git.publish({
      userId: session.userId,
      tenantId: session.tenantId,
      workspaceId,
      repoName: body?.repoName,
      branch: body?.branch,
    });
    if (!result.ok) {
      if (result.reason === 'workspace_not_found') {
        throw new NotFoundException(result.message);
      }
      if (result.reason === 'not_connected' || result.reason === 'workspace_not_running') {
        throw new HttpException(result.message, HttpStatus.CONFLICT);
      }
      throw new HttpException(result.message, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return result.publish;
  }

  /** The caller's publish history for a workspace. */
  @Get('workspaces/:workspaceId/publishes')
  history(@Param('workspaceId') workspaceId: string, @Req() req: Request) {
    const session = this.requireSession(req);
    return this.git.history(session.userId, workspaceId);
  }

  private requireSession(req: Request): SessionPayload {
    const session = this.sessions.fromCookieHeader(req.headers.cookie);
    if (!session) throw new UnauthorizedException('Sign in required');
    return session;
  }
}

/**
 * The student dashboard's aggregated view: enrolled roadmaps, competitive
 * rankings, and profile completion. Instructor/admin callers are rejected —
 * this is the student's own learning environment.
 */
@Controller('api/dashboard')
export class DashboardController {
  constructor(
    @Inject(DASHBOARD) private readonly dashboard: DashboardService,
    @Inject(SESSION) private readonly sessions: SessionService,
  ) {}

  @Get()
  async view(@Req() req: Request) {
    const session = this.sessions.fromCookieHeader(req.headers.cookie);
    if (!session) throw new UnauthorizedException('Sign in required');
    if (session.role !== 'student') {
      throw new ForbiddenException('The student dashboard is for students');
    }
    return this.dashboard.forStudent(session.userId, session.tenantId);
  }
}

/**
 * Report an Issue (ByteXL's in-product support form). Any signed-in member may
 * file a report; the queue is a support-desk view, so reads and status changes
 * require instructor or admin. Reports are always scoped to the caller's tenant.
 */
@Controller('api/support')
export class SupportController {
  constructor(
    @Inject(SUPPORT) private readonly support: SupportService,
    @Inject(SESSION) private readonly sessions: SessionService,
  ) {}

  /** File a report. The page the reporter was on is captured for reproduction. */
  @Post('issues')
  @HttpCode(201)
  async create(
    @Body()
    body: {
      category?: string;
      title?: string;
      description?: string;
      pageUrl?: string;
    },
    @Req() req: Request,
  ) {
    const session = this.requireSession(req);
    const result = await this.support.create({
      tenantId: session.tenantId,
      userId: session.userId,
      category: body?.category,
      title: body?.title,
      description: body?.description,
      pageUrl: body?.pageUrl,
    });
    if (!result.ok) {
      const message =
        result.reason === 'title_required'
          ? 'title is required'
          : result.reason === 'description_required'
            ? 'description is required'
            : result.reason === 'invalid_category'
              ? 'Unknown issue category'
              : 'Report is too long';
      throw new BadRequestException(message);
    }
    return result.issue;
  }

  /** The tenant's support queue, newest first (support desk only). */
  @Get('issues')
  async list(@Req() req: Request) {
    return this.support.list(this.requireInstructor(req).tenantId);
  }

  /** Move an issue through the queue (support desk only). */
  @Patch('issues/:id')
  async setStatus(
    @Param('id') id: string,
    @Body() body: { status?: string },
    @Req() req: Request,
  ) {
    const session = this.requireInstructor(req);
    if (!body?.status) throw new BadRequestException('status is required');
    const result = await this.support.setStatus(id, session.tenantId, body.status);
    if (!result.ok) {
      if (result.reason === 'invalid_status') {
        throw new BadRequestException('Unknown issue status');
      }
      throw new NotFoundException('Issue not found');
    }
    return result.issue;
  }

  private requireSession(req: Request): SessionPayload {
    const session = this.sessions.fromCookieHeader(req.headers.cookie);
    if (!session) throw new UnauthorizedException('Sign in required');
    return session;
  }

  private requireInstructor(req: Request): SessionPayload {
    const session = this.requireSession(req);
    if (session.role !== 'instructor' && session.role !== 'admin') {
      throw new ForbiddenException('Instructor or admin role required');
    }
    return session;
  }
}

/**
 * Skill Passport (ByteXL parity §2.8, "Resumes"). A student reads their own
 * passport; a recruiter (instructor or admin) reads the filtered shortlist. The
 * passport is derived on read, so it is never stale and needs no write path.
 */
@Controller('api/passport')
export class PassportController {
  constructor(
    @Inject(PASSPORT) private readonly passports: PassportService,
    @Inject(SESSION) private readonly sessions: SessionService,
  ) {}

  /** The caller's own Skill Passport. */
  @Get('me')
  async me(@Req() req: Request) {
    const session = this.requireSession(req);
    return this.passports.forStudent(session.userId, session.tenantId);
  }

  /** The recruiter's shortlist, with optional score/name filters. */
  @Get('recruiter')
  async recruiter(
    @Req() req: Request,
    @Query('minLabScore') minLabScore?: string,
    @Query('minCommunicationScore') minCommunicationScore?: string,
    @Query('minBadges') minBadges?: string,
    @Query('graduationYear') graduationYear?: string,
    @Query('institution') institution?: string,
    @Query('query') query?: string,
  ) {
    const session = this.requireInstructor(req);
    return this.passports.recruiter(session.tenantId, {
      minLabScore: numberOrUndefined(minLabScore),
      minCommunicationScore: numberOrUndefined(minCommunicationScore),
      minBadges: numberOrUndefined(minBadges),
      graduationYear: numberOrUndefined(graduationYear),
      institution: institution?.trim() || undefined,
      query: query?.trim() || undefined,
    });
  }

  /** The same shortlist as a CSV download a recruiter can take away. */
  @Get('recruiter.csv')
  async recruiterCsv(
    @Req() req: Request,
    @Res() res: Response,
    @Query('minLabScore') minLabScore?: string,
    @Query('minCommunicationScore') minCommunicationScore?: string,
    @Query('minBadges') minBadges?: string,
    @Query('graduationYear') graduationYear?: string,
    @Query('institution') institution?: string,
    @Query('query') query?: string,
  ) {
    const session = this.requireInstructor(req);
    const csv = await this.passports.recruiterCsv(session.tenantId, {
      minLabScore: numberOrUndefined(minLabScore),
      minCommunicationScore: numberOrUndefined(minCommunicationScore),
      minBadges: numberOrUndefined(minBadges),
      graduationYear: numberOrUndefined(graduationYear),
      institution: institution?.trim() || undefined,
      query: query?.trim() || undefined,
    });
    res
      .status(200)
      .setHeader('Content-Type', 'text/csv; charset=utf-8')
      .setHeader('Content-Disposition', 'attachment; filename="recruiter-shortlist.csv"')
      .send(csv);
  }

  private requireSession(req: Request): SessionPayload {
    const session = this.sessions.fromCookieHeader(req.headers.cookie);
    if (!session) throw new UnauthorizedException('Sign in required');
    return session;
  }

  private requireInstructor(req: Request): SessionPayload {
    const session = this.requireSession(req);
    if (session.role !== 'instructor' && session.role !== 'admin') {
      throw new ForbiddenException('Instructor or admin role required');
    }
    return session;
  }
}

/**
 * Contests (parity §2.8, Phase G). A timed contest with a live leaderboard.
 * Instructors author and publish; students see published contests, read the
 * standings, and file an entry. The phase (scheduled/live/ended) is derived from
 * the window on read, so a contest closes on time without a scheduler.
 */
@Controller('api/contests')
export class ContestController {
  constructor(
    @Inject(CONTEST) private readonly contests: ContestService,
    @Inject(SESSION) private readonly sessions: SessionService,
  ) {}

  /** Contests visible to the caller: published for students, all for staff. */
  @Get()
  async list(@Req() req: Request) {
    const session = this.requireSession(req);
    const isStaff = session.role === 'instructor' || session.role === 'admin';
    return this.contests.list(session.tenantId, { includeDrafts: isStaff });
  }

  /** Author a contest (instructor/admin only). Starts as a draft. */
  @Post()
  async create(@Req() req: Request, @Body() body: CreateContestBody) {
    const session = this.requireInstructor(req);
    const result = await this.contests.create({
      tenantId: session.tenantId,
      createdBy: session.userId,
      title: body.title ?? '',
      description: body.description,
      startAt: parseDate(body.startAt),
      endAt: parseDate(body.endAt),
      maxScore: body.maxScore,
      exerciseSlug: body.exerciseSlug ?? null,
    });
    if (!result.ok) throw new BadRequestException(result.reason);
    return this.contests.get(result.contest.id, session.tenantId);
  }

  /** One contest's detail. */
  @Get(':id')
  async get(@Req() req: Request, @Param('id') id: string) {
    const session = this.requireSession(req);
    const contest = await this.contests.get(id, session.tenantId);
    if (!contest) throw new NotFoundException('Contest not found');
    return contest;
  }

  /** Publish a draft (instructor/admin only). */
  @Post(':id/publish')
  async publish(@Req() req: Request, @Param('id') id: string) {
    const session = this.requireInstructor(req);
    const result = await this.contests.publish(id, session.tenantId);
    if (!result.ok) throw new NotFoundException('Contest not found');
    return this.contests.get(id, session.tenantId);
  }

  /** The live standings, with the caller's own row flagged. */
  @Get(':id/leaderboard')
  async leaderboard(@Req() req: Request, @Param('id') id: string) {
    const session = this.requireSession(req);
    const rows = await this.contests.leaderboard(id, session.tenantId, session.userId);
    if (!rows) throw new NotFoundException('Contest not found');
    return rows;
  }

  /** The caller's own standing in a contest, or null when not entered. */
  @Get(':id/me')
  async me(@Req() req: Request, @Param('id') id: string) {
    const session = this.requireSession(req);
    const row = await this.contests.myStanding(id, session.tenantId, session.userId);
    if (!row) throw new NotFoundException('No entry for this contest');
    return row;
  }

  /** Enter a contest, or file a score for it. Refused unless the contest is live. */
  @Post(':id/entries')
  async submit(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: SubmitEntryBody,
  ) {
    const session = this.requireSession(req);
    const result = await this.contests.submitEntry({
      contestId: id,
      tenantId: session.tenantId,
      userId: session.userId,
      score: Number(body.score ?? 0),
      durationMs: body.durationMs,
    });
    if (!result.ok) {
      if (result.reason === 'not_found') throw new NotFoundException('Contest not found');
      throw new BadRequestException(result.reason);
    }
    return result.row;
  }

  private requireSession(req: Request): SessionPayload {
    const session = this.sessions.fromCookieHeader(req.headers.cookie);
    if (!session) throw new UnauthorizedException('Sign in required');
    return session;
  }

  private requireInstructor(req: Request): SessionPayload {
    const session = this.requireSession(req);
    if (session.role !== 'instructor' && session.role !== 'admin') {
      throw new ForbiddenException('Instructor or admin role required');
    }
    return session;
  }
}

interface CreateContestBody {
  title?: string;
  description?: string;
  startAt?: string | null;
  endAt?: string | null;
  maxScore?: number;
  exerciseSlug?: string | null;
}

interface SubmitEntryBody {
  score?: number;
  durationMs?: number;
}

/** Parse an ISO date string, tolerating null/blank. Throws on a bad value. */
function parseDate(value: string | null | undefined): Date | null {
  if (value == null || value === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException(`Invalid date: ${value}`);
  }
  return date;
}

/**
 * AI Interviewer (parity §2.6). A student picks a prompt, records an answer, and
 * gets a communication score that lands on their Skill Passport.
 */
@Controller('api/interviews')
export class InterviewerController {
  constructor(
    @Inject(INTERVIEWER) private readonly interviewer: InterviewerService,
    @Inject(SESSION) private readonly sessions: SessionService,
  ) {}

  /** The prompt bank to choose from. */
  @Get('prompts')
  prompts(@Req() req: Request) {
    this.requireSession(req);
    return this.interviewer.prompts();
  }

  /** The caller's own sittings, newest first. */
  @Get('me')
  async history(@Req() req: Request) {
    const session = this.requireSession(req);
    return this.interviewer.history(session.userId);
  }

  /** Submit an answer for scoring. */
  @Post()
  @HttpCode(201)
  async submit(
    @Body() body: { promptId?: string; transcript?: string },
    @Req() req: Request,
  ) {
    const session = this.requireSession(req);
    if (!body?.promptId) throw new BadRequestException('promptId is required');
    const result = await this.interviewer.submit(
      session.userId,
      session.tenantId,
      body.promptId,
      body.transcript ?? '',
    );
    if (!result.ok) {
      const message =
        result.reason === 'unknown_prompt'
          ? 'Unknown interview prompt'
          : result.reason === 'empty'
            ? 'An answer is required'
            : 'Your answer is too long';
      throw new BadRequestException(message);
    }
    return result.attempt;
  }

  private requireSession(req: Request): SessionPayload {
    const session = this.sessions.fromCookieHeader(req.headers.cookie);
    if (!session) throw new UnauthorizedException('Sign in required');
    return session;
  }
}

/**
 * Clarity — CEFR-graded English practice (parity §2.10). A student practises
 * reading, writing, listening, or speaking; the response is graded and mapped to
 * a CEFR band. Faculty read the cohort roster behind `clarity:read`.
 */
@Controller('api/clarity')
export class ClarityController {
  constructor(
    @Inject(CLARITY) private readonly clarity: ClarityService,
    @Inject(SESSION) private readonly sessions: SessionService,
  ) {}

  /** The task bank, optionally filtered by `?skill=`. */
  @Get('tasks')
  tasks(@Query('skill') skill: string | undefined, @Req() req: Request) {
    this.requireSession(req);
    return this.clarity.tasks(skill);
  }

  /** The caller's own attempts, newest first. */
  @Get('me')
  async history(@Req() req: Request) {
    const session = this.requireSession(req);
    return this.clarity.history(session.userId);
  }

  /** The caller's CEFR level per skill, derived from their history. */
  @Get('me/levels')
  async levels(@Req() req: Request) {
    const session = this.requireSession(req);
    return this.clarity.levels(session.userId);
  }

  /** Submit a response for CEFR scoring. */
  @Post()
  @HttpCode(201)
  async submit(
    @Body() body: { taskId?: string; response?: string },
    @Req() req: Request,
  ) {
    const session = this.requireSession(req);
    if (!body?.taskId) throw new BadRequestException('taskId is required');
    const result = await this.clarity.submit(
      session.userId,
      session.tenantId,
      body.taskId,
      body.response ?? '',
    );
    if (!result.ok) {
      const message =
        result.reason === 'unknown_task'
          ? 'Unknown Clarity task'
          : result.reason === 'empty'
            ? 'A response is required'
            : 'Your response is too long';
      throw new BadRequestException(message);
    }
    return result.attempt;
  }

  /** The faculty roster: every student's band per skill. */
  @Get('roster')
  async roster(@Req() req: Request) {
    const session = requireCapability(this.sessions, req, 'clarity:read');
    return this.clarity.roster(session.tenantId);
  }

  private requireSession(req: Request): SessionPayload {
    const session = this.sessions.fromCookieHeader(req.headers.cookie);
    if (!session) throw new UnauthorizedException('Sign in required');
    return session;
  }
}

/**
 * AI Mentor (parity §2.5). A study coach the student can ask about a topic; the
 * conversation is persisted so it survives a reload.
 */
@Controller('api/mentor')
export class MentorController {
  constructor(
    @Inject(MENTOR) private readonly mentor: MentorService,
    @Inject(SESSION) private readonly sessions: SessionService,
  ) {}

  /** The caller's conversation, oldest first. */
  @Get('messages')
  async history(@Req() req: Request) {
    const session = this.requireSession(req);
    return this.mentor.history(session.userId);
  }

  /** Ask a question; the answer is appended to the conversation. */
  @Post('messages')
  @HttpCode(201)
  async ask(@Body() body: { question?: string }, @Req() req: Request) {
    const session = this.requireSession(req);
    const result = await this.mentor.ask(
      session.userId,
      session.tenantId,
      body?.question ?? '',
    );
    if (!result.ok) {
      throw new BadRequestException(
        result.reason === 'empty' ? 'A question is required' : 'Your question is too long',
      );
    }
    return result.result;
  }

  /** Clear the caller's conversation. */
  @Delete('messages')
  async clear(@Req() req: Request) {
    const session = this.requireSession(req);
    await this.mentor.clear(session.userId);
    return { cleared: true };
  }

  private requireSession(req: Request): SessionPayload {
    const session = this.sessions.fromCookieHeader(req.headers.cookie);
    if (!session) throw new UnauthorizedException('Sign in required');
    return session;
  }
}

/**
 * Feed (parity §2.9). A reverse-chronological stream of cohort activity —
 * submissions, completions, and posts — derived from the primary tables.
 */
@Controller('api/feed')
export class FeedController {
  constructor(
    @Inject(FEED) private readonly feed: FeedService,
    @Inject(SESSION) private readonly sessions: SessionService,
  ) {}

  @Get()
  async view(@Req() req: Request) {
    const session = this.requireSession(req);
    return this.feed.forUser(session.userId, session.tenantId);
  }

  private requireSession(req: Request): SessionPayload {
    const session = this.sessions.fromCookieHeader(req.headers.cookie);
    if (!session) throw new UnauthorizedException('Sign in required');
    return session;
  }
}

/**
 * Social (parity §2.9). A tenant-scoped micro-feed: posts and one-way follows.
 */
@Controller('api/social')
export class SocialController {
  constructor(
    @Inject(SOCIAL) private readonly social: SocialService,
    @Inject(SESSION) private readonly sessions: SessionService,
  ) {}

  /** The tenant feed; `?following=1` narrows to followed peers. */
  @Get('feed')
  async feed(@Req() req: Request, @Query('following') following?: string) {
    const session = this.requireSession(req);
    return this.social.feed(session.userId, session.tenantId, {
      followingOnly: following === '1' || following === 'true',
    });
  }

  /** The tenant directory with follow state. */
  @Get('members')
  async members(@Req() req: Request) {
    const session = this.requireSession(req);
    return this.social.directory(session.userId, session.tenantId);
  }

  /** Publish a post. */
  @Post('posts')
  @HttpCode(201)
  async post(@Body() body: { body?: string }, @Req() req: Request) {
    const session = this.requireSession(req);
    const result = await this.social.post(session.userId, session.tenantId, body?.body ?? '');
    if (!result.ok) {
      throw new BadRequestException(
        result.reason === 'empty' ? 'A message is required' : 'Your message is too long',
      );
    }
    return result.post;
  }

  /** Delete a post the caller owns. */
  @Delete('posts/:id')
  async remove(@Param('id') id: string, @Req() req: Request) {
    const session = this.requireSession(req);
    const result = await this.social.delete(session.userId, id);
    if (!result.ok) {
      if (result.reason === 'forbidden') {
        throw new ForbiddenException('You can only delete your own posts');
      }
      throw new NotFoundException('Post not found');
    }
    return { deleted: true };
  }

  /** Follow a peer. */
  @Post('follows/:userId')
  @HttpCode(201)
  async follow(@Param('userId') userId: string, @Req() req: Request) {
    const session = this.requireSession(req);
    const result = await this.social.follow(session.userId, session.tenantId, userId);
    if (!result.ok) {
      throw new BadRequestException(
        result.reason === 'self' ? 'You cannot follow yourself' : 'Unknown user',
      );
    }
    return { following: true };
  }

  /** Unfollow a peer. */
  @Delete('follows/:userId')
  async unfollow(@Param('userId') userId: string, @Req() req: Request) {
    const session = this.requireSession(req);
    await this.social.unfollow(session.userId, session.tenantId, userId);
    return { following: false };
  }

  private requireSession(req: Request): SessionPayload {
    const session = this.sessions.fromCookieHeader(req.headers.cookie);
    if (!session) throw new UnauthorizedException('Sign in required');
    return session;
  }
}

/**
 * Student Reports (parity §2.10). Cohort-level analytics for a trainer, rolled
 * from the same rows the gradebook and attendance boards read.
 */
@Controller('api/reports')
export class ReportsController {
  constructor(
    @Inject(REPORTS) private readonly reports: ReportsService,
    @Inject(SESSION) private readonly sessions: SessionService,
  ) {}

  /** Every batch in the tenant, each with its cohort roll-up. */
  @Get('batches')
  async list(@Req() req: Request) {
    const session = this.requireInstructor(req);
    return this.reports.forTenant(session.tenantId);
  }

  /** One batch's roll-up plus its per-student rows. */
  @Get('batches/:id')
  async detail(@Param('id') id: string, @Req() req: Request) {
    const session = this.requireInstructor(req);
    const detail = await this.reports.forBatch(session.tenantId, id);
    if (!detail) throw new NotFoundException('Batch not found');
    return detail;
  }

  private requireInstructor(req: Request): SessionPayload {
    const session = this.sessions.fromCookieHeader(req.headers.cookie);
    if (!session) throw new UnauthorizedException('Sign in required');
    if (session.role !== 'instructor' && session.role !== 'admin') {
      throw new ForbiddenException('Instructor or admin role required');
    }
    return session;
  }
}

/**
 * Question Bank (parity §2.4). A tenant-scoped library of reusable questions an
 * author can drop into a test. Authoring is instructor/admin only.
 */
@Controller('api/question-bank')
export class QuestionBankController {
  constructor(
    @Inject(QUESTION_BANK) private readonly bank: QuestionBankService,
    @Inject(SESSION) private readonly sessions: SessionService,
  ) {}

  /** The tenant's bank, optionally filtered by kind or tag. */
  @Get()
  async list(@Req() req: Request, @Query('kind') kind?: string, @Query('tag') tag?: string) {
    const session = this.requireInstructor(req);
    return this.bank.list(session.tenantId, { kind, tag });
  }

  /** Add a question to the bank. */
  @Post()
  @HttpCode(201)
  async create(
    @Body()
    body: {
      kind?: string;
      prompt?: string;
      options?: string[];
      correct?: unknown;
      maxScore?: number;
      tags?: string[];
    },
    @Req() req: Request,
  ) {
    const session = this.requireInstructor(req);
    const result = await this.bank.create({
      tenantId: session.tenantId,
      createdBy: session.userId,
      kind: body?.kind,
      prompt: body?.prompt,
      options: body?.options,
      correct: body?.correct,
      maxScore: body?.maxScore,
      tags: body?.tags,
    });
    if (!result.ok) {
      const message =
        result.reason === 'invalid_kind'
          ? 'Unknown question kind'
          : result.reason === 'prompt_required'
            ? 'A prompt is required'
            : result.reason === 'options_required'
              ? 'A multiple-choice question needs at least two options'
              : 'The prompt is too long';
      throw new BadRequestException(message);
    }
    return result.question;
  }

  /** Remove a question the tenant owns. */
  @Delete(':id')
  async remove(@Param('id') id: string, @Req() req: Request) {
    const session = this.requireInstructor(req);
    const removed = await this.bank.remove(session.tenantId, id);
    if (!removed) throw new NotFoundException('Question not found');
    return { deleted: true };
  }

  private requireInstructor(req: Request): SessionPayload {
    const session = this.sessions.fromCookieHeader(req.headers.cookie);
    if (!session) throw new UnauthorizedException('Sign in required');
    if (session.role !== 'instructor' && session.role !== 'admin') {
      throw new ForbiddenException('Instructor or admin role required');
    }
    return session;
  }
}

/**
 * Organizations (parity §2.2). The admin console's view of the tenant — its
 * departments, headcounts, and batch count — plus department management.
 */
@Controller('api/organizations')
export class OrganizationsController {
  constructor(
    @Inject(ORGS) private readonly orgs: OrgService,
    @Inject(SESSION) private readonly sessions: SessionService,
  ) {}

  /** The caller's tenant structure. */
  @Get()
  async view(@Req() req: Request) {
    const session = this.requireAdmin(req);
    const view = await this.orgs.view(session.tenantId);
    if (!view) throw new NotFoundException('Organization not found');
    return view;
  }

  /** Create a department. */
  @Post('departments')
  @HttpCode(201)
  async createDepartment(@Body() body: { name?: string }, @Req() req: Request) {
    const session = this.requireAdmin(req);
    const result = await this.orgs.createDepartment(session.tenantId, body?.name ?? '');
    if (!result.ok) {
      throw new BadRequestException(
        result.reason === 'name_required'
          ? 'A department name is required'
          : 'A department with that name already exists',
      );
    }
    return result.department;
  }

  /** Delete a department the tenant owns. */
  @Delete('departments/:id')
  async removeDepartment(@Param('id') id: string, @Req() req: Request) {
    const session = this.requireAdmin(req);
    const removed = await this.orgs.removeDepartment(session.tenantId, id);
    if (!removed) throw new NotFoundException('Department not found');
    return { deleted: true };
  }

  private requireAdmin(req: Request): SessionPayload {
    const session = this.sessions.fromCookieHeader(req.headers.cookie);
    if (!session) throw new UnauthorizedException('Sign in required');
    if (session.role !== 'admin') {
      throw new ForbiddenException('Admin role required');
    }
    return session;
  }
}

/** Parse a query value to a finite number, or undefined when absent/invalid. */
function numberOrUndefined(value: string | undefined): number | undefined {
  if (value == null || value.trim() === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}
