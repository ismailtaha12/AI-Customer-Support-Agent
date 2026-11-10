import { Injectable } from '@nestjs/common';
import { LlmService } from '../llm/llm.service';
import { PROMPTS } from '../llm/prompts';
import type { Chunk } from './chunker.service';

const MAX_DOC_CHARS = 8000;
const CONCURRENCY = 4;

// CONTEXTUAL RETRIEVAL: a chunk like "The fee is 150 EGP." is ambiguous on its own.
// We ask a cheap LLM to write a short blurb that situates the chunk in its document
// ("Late-cancellation fee in the appointment cancellation policy"), then embed blurb + chunk.
@Injectable()
export class ContextualizerService {
  constructor(private readonly llm: LlmService) {}

  async contextualize(title: string, documentBody: string, chunks: Chunk[]): Promise<string[]> {
    const doc = documentBody.slice(0, MAX_DOC_CHARS);
    const out: string[] = [];
    // limited concurrency: fast enough, gentle on rate limits
    for (let i = 0; i < chunks.length; i += CONCURRENCY) {
      const batch = chunks.slice(i, i + CONCURRENCY);
      out.push(...(await Promise.all(batch.map((c) => this.one(title, doc, c)))));
    }
    return out;
  }

  private async one(title: string, doc: string, chunk: Chunk): Promise<string> {
    const msg = await this.llm.chat({
      tier: 'fast',
      purpose: 'contextualize',
      maxTokens: 120,
      messages: [
        { role: 'system', content: PROMPTS.contextualize },
        // The document comes first and is identical for every chunk -> provider prompt caching
        // can reuse it, which makes this step much cheaper for long documents.
        { role: 'user', content: `<document title="${title}">\n${doc}\n</document>\n\n<chunk>\n${chunk.content}\n</chunk>` },
      ],
    });
    return (msg.content ?? '').trim();
  }
}
