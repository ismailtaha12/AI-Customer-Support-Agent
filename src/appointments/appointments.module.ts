import { Module } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { AppointmentsService } from './appointments.service';
import { DemoController } from './demo.controller';

@Module({ controllers: [DemoController], providers: [AppointmentsService, AuthGuard], exports: [AppointmentsService] })
export class AppointmentsModule {}
