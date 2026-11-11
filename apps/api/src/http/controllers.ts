import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { SIGNATURE_HEADER } from '@tenxlab/contracts';
import { JwtService } from '../crypto/jwt.service';
import { PartnerSsoService } from '../identity/partner-sso.service';
import { LabLaunchService } from '../labs/lab-launch.service';
import { GradebookWebhookService } from '../gradebook/gradebook-webhook.service';
import { GRADEBOOK, JWT, LAUNCH, SSO } from './tokens';

@Controller()
export class JwksController {
  constructor(@Inject(JWT) private readonly jwt: JwtService) {}

  @Get('.well-known/jwks.json')
  @Header('Cache-Control', 'public, max-age=300')
  jwks() {
    return this.jwt.jwks();
  }
}

@Controller('api/_callback/sso')
export class PartnerSsoController {
  constructor(@Inject(SSO) private readonly sso: PartnerSsoService) {}

  @Get('partner')
  async partner(@Query('token') token: string, @Res() res: Response) {
    if (!token) return res.redirect('/login?reason=invalid_signature');
    const result = await this.sso.verify(token);
    if (!result.ok) return res.redirect(`/login?reason=${result.reason}`);
    // In production this sets an httpOnly session cookie. Left explicit here so
    // the redirect contract is unambiguous.
    return res.redirect(`/dashboard?tenant=${result.tenantId}`);
  }
}

@Controller('api/labs')
export class LabController {
  constructor(@Inject(LAUNCH) private readonly launch: LabLaunchService) {}

  @Post('launch')
  async launchLab(
    @Body()
    body: {
      userId: string;
      tenantId: string;
      lessonId: string;
      batchId?: string;
      courseId?: string;
    },
  ) {
    const result = await this.launch.launch(body);
    if (!result.ok) {
      throw new UnauthorizedException(result.message);
    }
    return {
      launchUrl: result.launchUrl,
      sessionId: result.session.id,
      tier: result.session.tier,
    };
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
