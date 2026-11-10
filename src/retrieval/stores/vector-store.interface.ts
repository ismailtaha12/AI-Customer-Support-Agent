// Every vector database implements this interface, so the rest of the app (and the eval)
// can swap Supabase/pgvector for Chroma without code changes.

export type Metadata = Record<string, string>;

export interface ChunkRecord {
  id: string;
  documentId: string;
  title: string;
  chunkIndex: number;
  content: string; // raw chunk text (shown to the LLM)
  context: string; // LLM-written situating blurb (contextual retrieval); may be ''
  embedding: number[]; // embedding of context + content
  metadata: Metadata; // e.g. { category: 'billing', version: '1' }
}

export interface SearchHit {
  id: string;
  documentId: string;
  title: string;
  content: string;
  context: string;
  metadata: Metadata;
  score: number;
}

export interface SearchArgs {
  query: string; // raw text (used by keyword search where supported)
  embedding: number[]; // query vector (used by semantic search)
  filters?: Metadata; // metadata filter, e.g. { category: 'billing' }
  k: number;
}

export interface VectorStore {
  readonly name: string;
  upsertChunks(chunks: ChunkRecord[]): Promise<void>;
  deleteByDocument(documentId: string): Promise<void>;
  search(args: SearchArgs): Promise<SearchHit[]>;
}

// Nest injection token for "the active store"
export const VECTOR_STORE = Symbol('VECTOR_STORE');
