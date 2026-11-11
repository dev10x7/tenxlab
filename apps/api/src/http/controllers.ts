import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
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
import { EXERCISE_BOOTSTRAP, EXERCISE_CHECK } from '../catalog/demo-data';
import { CATALOG, GRADEBOOK, JWT, LAUNCH, SESSION, SSO } from './tokens';

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
