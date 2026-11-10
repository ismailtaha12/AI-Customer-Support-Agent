import { Controller, NotFoundException, Post, Req, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard, type AuthedRequest } from '../auth/auth.guard';
import type { Env } from '../config/env';
import { AppointmentsService } from './appointments.service';

// POST /demo/seed: used by the demo page right after "Try as guest".
// Disabled unless DEMO_MODE=true, so it can't be abused in a real deployment.
@Controller('demo')
@UseGuards(AuthGuard)
export class DemoController {
  constructor(
    private readonly appointments: AppointmentsService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Post('seed')
  seed(@Req() req: AuthedRequest) {
    if (!this.config.get('DEMO_MODE', { infer: true })) throw new NotFoundException();
    return this.appointments.seedDemo(req.user.id);
  }
}
