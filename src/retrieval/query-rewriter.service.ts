import { Injectable } from '@nestjs/common';
import type { ChatTurn } from '../common/types';
import { LlmService } from '../llm/llm.service';
import { PROMPTS } from '../llm/prompts';
import { RewriteSchema } from '../llm/schemas';

// Query rewriting turns "what about for kids?" into a standalone search query.
@Injectable()
export class QueryRewriter {
  constructor(private readonly llm: LlmService) {}

  async rewrite(question: string, history: ChatTurn[], attempt: number): Promise<string> {
    // Cost optimisation: first attempt + no history means the question already stands alone.
    if (attempt === 0 && history.length === 0) return question;

    const transcript = history
      .slice(-6)
      .map((t) => `${t.role}: ${t.content}`)
      .join('\n');

    const out = await this.llm.structured({
      tier: 'fast',
      purpose: 'rewrite_query',
      schemaName: 'rewrite',
      schema: RewriteSchema,
      system: PROMPTS.rewrite,
      user: `attempt: ${attempt}\n\nConversation so far:\n${transcript || '(none)'}\n\nLatest message: ${question}`,
    });
    return out.standalone_query.trim() || question;
  }
}
