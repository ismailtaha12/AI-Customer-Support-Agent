import { Controller, Get, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../auth/auth.guard';
import { UsageService } from './usage.service';

@Controller('usage')
@UseGuards(AdminGuard)
export class UsageController {
  constructor(private readonly usage: UsageService) {}

  // p50/p95 latency and cost per pipeline step, plus the most expensive conversations
  @Get('summary')
  summary() {
    return this.usage.summary();
  }
}
