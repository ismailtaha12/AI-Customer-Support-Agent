import { Injectable, Logger } from '@nestjs/common';
import type { Citation } from '../common/types';
import { LlmService } from '../llm/llm.service';
import { PROMPTS } from '../llm/prompts';
import { GroundednessSchema } from '../llm/schemas';
import type { SearchHit } from '../retrieval/stores/vector-store.interface';
import { PiiRedactor } from './pii.redactor';

export const UNGROUNDED_FALLBACK =
  "I'm not confident I can answer that accurately from our help centre. I can open a ticket so a team member can help you. Would you like that?";

export interface OutputCheck {
  answer: string;
  citations: Citation[];
  grounded: boolean;
  flags: string[]; // 'pii_redacted' | 'ungrounded' | 'no_citations'
}

// Pull [n] markers out of the answer; drop markers that don't point at a real passage.
export function extractCitations(answer: string, contexts: SearchHit[]): { answer: string; citations: Citation[] } {
  const used = new Set<number>();
  const cleaned = answer.replace(/\[(\d+)\]/g, (marker, n: string) => {
    const idx = Number(n);
    if (idx >= 1 && idx <= contexts.length) {
      used.add(idx);
      return marker;
    }
    return ''; // hallucinated citation: remove it
  });
  const citations = [...used]
    .sort((a, b) => a - b)
    .map((n) => ({ n, chunkId: contexts[n - 1].id, documentId: contexts[n - 1].documentId, title: contexts[n - 1].title }));
  // tidy up whitespace left behind by removed markers ("fee [7] ." -> "fee.")
  const tidy = cleaned.replace(/\s{2,}/g, ' ').replace(/\s+([.,;:!?])/g, '$1').trim();
  return { answer: tidy, citations };
}

@Injectable()
export class OutputGuard {
  private readonly logger = new Logger(OutputGuard.name);

  constructor(
    private readonly llm: LlmService,
    private readonly pii: PiiRedactor,
  ) {}

  /**
   * verifyGrounding=true for RAG answers: every claim must be backed by the retrieved
   * passages AND carry at least one valid citation. Otherwise we replace the answer.
   */
  async check(input: { answer: string; contexts: SearchHit[]; verifyGrounding: boolean }): Promise<OutputCheck> {
    const flags: string[] = [];

    // 1) never echo PII back to the user (or into logs / the database)
    const redacted = this.pii.redact(input.answer);
    if (redacted.found.length) flags.push('pii_redacted');

    if (!input.verifyGrounding) {
      return { answer: redacted.text, citations: [], grounded: true, flags };
    }

    // 2) citations must exist and be valid
    const { answer, citations } = extractCitations(redacted.text, input.contexts);
    if (!citations.length) {
      flags.push('no_citations');
      return { answer: UNGROUNDED_FALLBACK, citations: [], grounded: false, flags };
    }

    // 3) LLM-as-fact-checker on the answer vs. the passages it cites
    const passages = input.contexts.map((c, i) => `[${i + 1}] ${c.content}`).join('\n\n');
    try {
      const verdict = await this.llm.structured({
        tier: 'fast',
        purpose: 'groundedness',
        schemaName: 'groundedness',
        schema: GroundednessSchema,
        system: PROMPTS.groundedness,
        user: `Passages:\n${passages}\n\nAnswer:\n${answer}`,
      });
      if (!verdict.grounded) {
        this.logger.warn(`ungrounded answer blocked: ${verdict.unsupported_claims.join(' | ')}`);
        flags.push('ungrounded');
        return { answer: UNGROUNDED_FALLBACK, citations: [], grounded: false, flags };
      }
    } catch (err) {
      // Fail closed here: an unverifiable factual answer is worse than a polite fallback.
      this.logger.warn(`groundedness check failed: ${(err as Error).message}`);
      flags.push('ungrounded');
      return { answer: UNGROUNDED_FALLBACK, citations: [], grounded: false, flags };
    }

    return { answer, citations, grounded: true, flags };
  }
}
