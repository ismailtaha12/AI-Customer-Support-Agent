import { Module } from '@nestjs/common';
import { AdminGuard } from '../auth/auth.guard';
import { RetrievalModule } from '../retrieval/retrieval.module';
import { ChunkerService } from './chunker.service';
import { ContextualizerService } from './contextualizer.service';
import { IngestionController } from './ingestion.controller';
import { IngestionService } from './ingestion.service';

@Module({
  imports: [RetrievalModule],
  controllers: [IngestionController],
  providers: [IngestionService, ChunkerService, ContextualizerService, AdminGuard],
  exports: [IngestionService, ChunkerService],
})
export class IngestionModule {}
