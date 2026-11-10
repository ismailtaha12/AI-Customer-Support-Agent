import { Inject, Injectable } from '@nestjs/common';
import { LlmService } from '../llm/llm.service';
import { VECTOR_STORE, type Metadata, type SearchHit, type VectorStore } from './stores/vector-store.interface';

export interface RetrieveArgs {
  query: string;
  filters?: Metadata;
  k?: number;
}

@Injectable()
export class RetrievalService {
  constructor(
    private readonly llm: LlmService,
    @Inject(VECTOR_STORE) private readonly store: VectorStore,
  ) {}

  // Embed the query (memoised in LlmService) and search the active store.
  async retrieve({ query, filters, k = 5 }: RetrieveArgs): Promise<SearchHit[]> {
    const [embedding] = await this.llm.embed([query]);
    return this.store.search({ query, embedding, filters, k });
  }

  // Same as retrieve() but for a specific store: used by the eval to compare backends.
  async retrieveFrom(store: VectorStore, args: RetrieveArgs): Promise<SearchHit[]> {
    const [embedding] = await this.llm.embed([args.query]);
    return store.search({ query: args.query, embedding, filters: args.filters, k: args.k ?? 5 });
  }
}
