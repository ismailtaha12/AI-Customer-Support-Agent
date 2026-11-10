import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChromaClient, Collection, Where } from 'chromadb';
import type { Env } from '../../config/env';
import type { ChunkRecord, Metadata, SearchArgs, SearchHit, VectorStore } from './vector-store.interface';

const COLLECTION = 'support_kb';

// ChromaDB adapter. Dense (semantic) search only: Chroma has no keyword side here, which is
// exactly what makes it a useful baseline against the hybrid pgvector store in the eval.
@Injectable()
export class ChromaStore implements VectorStore {
  readonly name = 'chroma-dense';
  private readonly logger = new Logger(ChromaStore.name);
  private collection?: Collection;

  constructor(private readonly config: ConfigService<Env, true>) {}

  get enabled(): boolean {
    return !!this.config.get('CHROMA_URL', { infer: true });
  }

  // Lazy connect: Chroma is optional, so nothing happens unless it's actually used.
  private async getCollection(): Promise<Collection> {
    if (this.collection) return this.collection;
    const url = new URL(this.config.get('CHROMA_URL', { infer: true }) ?? '');
    const client = new ChromaClient({
      host: url.hostname,
      port: Number(url.port) || (url.protocol === 'https:' ? 443 : 8000),
      ssl: url.protocol === 'https:',
    });
    this.collection = await client.getOrCreateCollection({
      name: COLLECTION,
      embeddingFunction: null, // we always pass our own embeddings
      configuration: { hnsw: { space: 'cosine' } },
    });
    this.logger.log(`Connected to Chroma at ${url.origin}`);
    return this.collection;
  }

  async upsertChunks(chunks: ChunkRecord[]): Promise<void> {
    if (!chunks.length) return;
    const col = await this.getCollection();
    await col.upsert({
      ids: chunks.map((c) => c.id),
      embeddings: chunks.map((c) => c.embedding),
      documents: chunks.map((c) => c.content),
      // Chroma metadata must be flat primitives
      metadatas: chunks.map((c) => ({
        ...c.metadata,
        documentId: c.documentId,
        title: c.title,
        context: c.context,
        chunkIndex: c.chunkIndex,
      })),
    });
  }

  async deleteByDocument(documentId: string): Promise<void> {
    const col = await this.getCollection();
    await col.delete({ where: { documentId } });
  }

  async search({ embedding, filters, k }: SearchArgs): Promise<SearchHit[]> {
    const col = await this.getCollection();
    const res = await col.query({
      queryEmbeddings: [embedding],
      nResults: k,
      where: this.toWhere(filters),
      include: ['documents', 'metadatas', 'distances'],
    });

    const ids = res.ids[0] ?? [];
    return ids.map((id, i) => {
      const meta = (res.metadatas[0]?.[i] ?? {}) as Record<string, string | number>;
      const { documentId, title, context, chunkIndex, ...rest } = meta;
      void chunkIndex;
      return {
        id,
        documentId: String(documentId ?? ''),
        title: String(title ?? ''),
        content: res.documents[0]?.[i] ?? '',
        context: String(context ?? ''),
        metadata: rest as Metadata,
        score: 1 - (res.distances[0]?.[i] ?? 1), // cosine distance -> similarity
      };
    });
  }

  // { a: 'x', b: 'y' } -> { $and: [{ a: 'x' }, { b: 'y' }] } (Chroma wants $and for multiple keys)
  private toWhere(filters?: Metadata): Where | undefined {
    const entries = Object.entries(filters ?? {});
    if (!entries.length) return undefined;
    if (entries.length === 1) return { [entries[0][0]]: entries[0][1] };
    return { $and: entries.map(([k, v]) => ({ [k]: v })) };
  }
}
