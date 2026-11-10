import { Global, Module } from '@nestjs/common';
import { AdminGuard } from '../auth/auth.guard';
import { UsageController } from './usage.controller';
import { UsageService } from './usage.service';

@Global()
@Module({ controllers: [UsageController], providers: [UsageService, AdminGuard], exports: [UsageService] })
export class ObservabilityModule {}
