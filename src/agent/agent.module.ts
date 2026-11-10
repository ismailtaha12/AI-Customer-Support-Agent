import { Module } from '@nestjs/common';
import { AppointmentsModule } from '../appointments/appointments.module';
import { CacheModule } from '../cache/cache.module';
import { GuardrailsModule } from '../guardrails/guardrails.module';
import { RetrievalModule } from '../retrieval/retrieval.module';
import { TicketsModule } from '../tickets/tickets.module';
import { AgentService } from './agent.service';
import { SupportGraphFactory } from './graph/support.graph';
import { ToolRegistry } from './tools/tool-registry';

@Module({
  imports: [RetrievalModule, CacheModule, GuardrailsModule, TicketsModule, AppointmentsModule],
  providers: [SupportGraphFactory, ToolRegistry, AgentService],
  exports: [AgentService],
})
export class AgentModule {}
