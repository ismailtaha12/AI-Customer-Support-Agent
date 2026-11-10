import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import { QueryRewriter } from './query-rewriter.service';
import { RetrievalService } from './retrieval.service';
import { ChromaStore } from './stores/chroma.store';
import { PgVectorStore } from './stores/pgvector.store';
import { VECTOR_STORE } from './stores/vector-store.interface';

@Module({
  providers: [
    PgVectorStore,
    ChromaStore,
    // Pick the active store from config (default: Supabase pgvector)
    {
      provide: VECTOR_STORE,
      inject: [ConfigService, PgVectorStore, ChromaStore],
      useFactory: (config: ConfigService<Env, true>, pg: PgVectorStore, chroma: ChromaStore) =>
        config.get('VECTOR_STORE', { infer: true }) === 'chroma' ? chroma : pg,
    },
    RetrievalService,
    QueryRewriter,
  ],
  exports: [RetrievalService, QueryRewriter, PgVectorStore, ChromaStore],
})
export class RetrievalModule {}
