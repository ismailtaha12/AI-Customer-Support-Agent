import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
import type { ChunkRecord, SearchArgs, SearchHit, VectorStore } from './vector-store.interface';

// Supabase Postgres + pgvector. Search = HYBRID (semantic + keyword fused with RRF),
// implemented in SQL: see supabase/migrations/0002_search_functions.sql
@Injectable()
export class PgVectorStore implements VectorStore {
  readonly name = 'pgvector-hybrid';

  constructor(private readonly supabase: SupabaseService) {}

  async upsertChunks(chunks: ChunkRecord[]): Promise<void> {
    const rows = chunks.map((c) => ({
      id: c.id,
      document_id: c.documentId,
      chunk_index: c.chunkIndex,
      content: c.content,
      context: c.context,
      embedding: c.embedding,
      metadata: c.metadata,
    }));
    // insert in small batches to keep request bodies reasonable (1536 floats per row)
    for (let i = 0; i < rows.length; i += 50) {
      const { error } = await this.supabase.admin.from('chunks').insert(rows.slice(i, i + 50));
      if (error) throw new Error(`chunk insert failed: ${error.message}`);
    }
  }

  async deleteByDocument(documentId: string): Promise<void> {
    const { error } = await this.supabase.admin.from('chunks').delete().eq('document_id', documentId);
    if (error) throw new Error(`chunk delete failed: ${error.message}`);
  }

  async search({ query, embedding, filters, k }: SearchArgs): Promise<SearchHit[]> {
    const { data, error } = await this.supabase.admin.rpc('hybrid_search', {
      query_text: query,
      query_embedding: embedding,
      match_count: k,
      filter_metadata: filters ?? {}, // metadata filtering happens inside SQL, before ranking
    });
    if (error) throw new Error(`hybrid_search failed: ${error.message}`);

    return (data ?? []).map((r: any) => ({
      id: r.id,
      documentId: r.document_id,
      title: r.title,
      content: r.content,
      context: r.context,
      metadata: r.metadata,
      score: r.score,
    }));
  }
}
