import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { Env } from '../config/env';
import { LlmService } from '../llm/llm.service';
import { ChromaStore } from '../retrieval/stores/chroma.store';
import { PgVectorStore } from '../retrieval/stores/pgvector.store';
import type { ChunkRecord, VectorStore } from '../retrieval/stores/vector-store.interface';
import { SupabaseService } from '../supabase/supabase.service';
import { ChunkerService } from './chunker.service';
import { ContextualizerService } from './contextualizer.service';
import { parseFrontmatter } from './frontmatter';

export interface IngestResult {
  slug: string;
  chunks: number;
  skipped: boolean;
}

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly supabase: SupabaseService,
    private readonly llm: LlmService,
    private readonly chunker: ChunkerService,
    private readonly contextualizer: ContextualizerService,
    private readonly pg: PgVectorStore,
    private readonly chroma: ChromaStore,
  ) {}

  /** Ingest every .md file in a folder. */
  async ingestDirectory(dir: string, opts: { force?: boolean } = {}): Promise<IngestResult[]> {
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.md')).sort();
    const results: IngestResult[] = [];
    for (const file of files) {
      const raw = await fs.readFile(path.join(dir, file), 'utf8');
      results.push(await this.ingestDocument(path.basename(file, '.md'), raw, opts));
    }
    return results;
  }

  /** Pipeline for one document: parse -> chunk -> contextualise -> embed -> store. */
  async ingestDocument(slug: string, raw: string, opts: { force?: boolean } = {}): Promise<IngestResult> {
    const { data, body } = parseFrontmatter(raw);
    const hash = createHash('sha256').update(raw).digest('hex');

    // Skip unchanged documents (re-ingesting costs LLM + embedding tokens)
    const { data: existing } = await this.supabase.admin
      .from('documents')
      .select('id, content_hash')
      .eq('slug', slug)
      .maybeSingle();
    if (existing?.content_hash === hash && !opts.force) {
      this.logger.log(`${slug}: unchanged, skipped`);
      return { slug, chunks: 0, skipped: true };
    }

    const title = data.title ?? slug;
    const metadata = { category: data.category ?? 'general', version: data.version ?? '1' };

    const { data: doc, error } = await this.supabase.admin
      .from('documents')
      .upsert({ slug, title, content_hash: hash, metadata, updated_at: new Date().toISOString() }, { onConflict: 'slug' })
      .select('id')
      .single();
    if (error || !doc) throw new Error(`document upsert failed: ${error?.message}`);

    const chunks = this.chunker.chunk(body);

    // Contextual retrieval is a feature flag so the eval can measure its effect (on vs off).
    const contexts = this.config.get('CONTEXTUAL_RETRIEVAL', { infer: true })
      ? await this.contextualizer.contextualize(title, body, chunks)
      : chunks.map(() => '');

    // What gets embedded = blurb + heading path + chunk text
    const embeddings = await this.llm.embed(
      chunks.map((c, i) => [contexts[i], c.headingPath, c.content].filter(Boolean).join('\n\n')),
    );

    const records: ChunkRecord[] = chunks.map((c, i) => ({
      id: randomUUID(),
      documentId: doc.id,
      title,
      chunkIndex: c.index,
      content: c.content,
      context: contexts[i],
      embedding: embeddings[i],
      metadata,
    }));

    // Always write to pgvector; also to Chroma when configured (used for the eval comparison)
    const stores: VectorStore[] = [this.pg, ...(this.chroma.enabled ? [this.chroma] : [])];
    for (const store of stores) {
      await store.deleteByDocument(doc.id);
      await store.upsertChunks(records);
    }

    this.logger.log(`${slug}: ${records.length} chunks -> ${stores.map((s) => s.name).join(', ')}`);
    return { slug, chunks: records.length, skipped: false };
  }
}
