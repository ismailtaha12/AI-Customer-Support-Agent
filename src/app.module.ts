import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AgentModule } from './agent/agent.module';
import { AppController } from './app.controller';
import { AppointmentsModule } from './appointments/appointments.module';
import { CacheModule } from './cache/cache.module';
import { ChatModule } from './chat/chat.module';
import { validateEnv } from './config/env';
import { GuardrailsModule } from './guardrails/guardrails.module';
import { IngestionModule } from './ingestion/ingestion.module';
import { LlmModule } from './llm/llm.module';
import { ObservabilityModule } from './observability/observability.module';
import { RetrievalModule } from './retrieval/retrieval.module';
import { SupabaseModule } from './supabase/supabase.module';
import { TicketsModule } from './tickets/tickets.module';

@Module({
  controllers: [AppController],
  imports: [
    // Loads .env into process.env too: that's how LangSmith picks up LANGSMITH_* variables
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    SupabaseModule,
    ObservabilityModule,
    LlmModule,
    CacheModule,
    GuardrailsModule,
    RetrievalModule,
    IngestionModule,
    TicketsModule,
    AppointmentsModule,
    AgentModule,
    ChatModule,
  ],
})
export class AppModule {}
