import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Citation } from '../common/types';
import type { Env } from '../config/env';
import { LlmService } from '../llm/llm.service';
import { SupabaseService } from '../supabase/supabase.service';

export interface CachedAnswer {
  answer: string;
  citations: Citation[];
  similarity: number;
}

// SEMANTIC CACHE: "How do I get a refund?" and "how can I be refunded" share one cached answer.
// Only grounded, FAQ-style answers are cached (never anything based on a customer's own data).
@Injectable()
export class SemanticCacheService {
  private readonly logger = new Logger(SemanticCacheService.name);

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly supabase: SupabaseService,
    private readonly llm: LlmService,
  ) {}

  private get enabled() {
    return this.config.get('SEMANTIC_CACHE', { infer: true });
  }

  async get(query: string): Promise<CachedAnswer | null> {
    if (!this.enabled) return null;
    const [embedding] = await this.llm.embed([query]);
    const { data, error } = await this.supabase.admin.rpc('match_cache', {
      query_embedding: embedding,
      similarity_threshold: this.config.get('CACHE_SIMILARITY_THRESHOLD', { infer: true }),
      ttl_hours: this.config.get('CACHE_TTL_HOURS', { infer: true }),
    });
    if (error) {
      this.logger.warn(`cache lookup failed: ${error.message}`);
      return null; // a cache problem must never break answering
    }
    const hit = data?.[0];
    return hit ? { answer: hit.answer, citations: hit.sources ?? [], similarity: hit.similarity } : null;
  }

  async put(query: string, answer: string, citations: Citation[]): Promise<void> {
    if (!this.enabled) return;
    const [embedding] = await this.llm.embed([query]); // served from the embedding memo, no extra API call
    const { error } = await this.supabase.admin
      .from('semantic_cache')
      .insert({ question: query, embedding, answer, sources: citations });
    if (error) this.logger.warn(`cache write failed: ${error.message}`);
  }
}
