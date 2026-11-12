import {
  BadRequestException,
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
  Param,
  Patch,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { SIGNATURE_HEADER } from '@tenxlab/contracts';
import { JwtService } from '../crypto/jwt.service';
import { PartnerSsoService } from '../identity/partner-sso.service';
import { SessionService, type SessionPayload } from '../identity/session.service';
import { findDemoUserByEmail } from '../identity/demo-users';
import { LabLaunchService } from '../labs/lab-launch.service';
import { GradebookWebhookService } from '../gradebook/gradebook-webhook.service';
import { CatalogService } from '../catalog/catalog.service';
import { BatchService } from '../batches/batch.service';
import { EditorService } from '../editor/editor.service';
import { EXERCISE_BOOTSTRAP, EXERCISE_CHECK } from '../catalog/demo-data';
import { BATCH, CATALOG, EDITOR, GRADEBOOK, JWT, LAUNCH, SESSION, SSO } from './tokens';

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
    return this.catalog.listCourses(this.requireSession(req).userId);
  }

  @Get('courses/:slug')
  async course(@Param('slug') slug: string, @Req() req: Request) {
    const course = await this.catalog.getCourse(slug, this.requireSession(req).userId);
    if (!course) throw new NotFoundException('Course not found');
    return course;
  }

  private requireSession(req: Request): SessionPayload {
    const session = this.sessions.fromCookieHeader(req.headers.cookie);
    if (!session) throw new UnauthorizedException('Sign in required');
    return session;
  }
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
      throw new UnauthorizedException(result.message);
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
      ideUrl: row.ideUrl ?? null,
    };
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

  private requireSession(req: Request): SessionPayload {
    const session = this.sessions.fromCookieHeader(req.headers.cookie);
    if (!session) throw new UnauthorizedException('Sign in required');
    return session;
  }
}
