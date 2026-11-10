import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import { LlmService } from '../llm/llm.service';
import { PROMPTS } from '../llm/prompts';
import { InjectionSchema } from '../llm/schemas';
import { PiiRedactor } from './pii.redactor';

export const MAX_INPUT_CHARS = 2000;

// Layer 1: cheap, deterministic patterns. Exported so it can be unit-tested without an LLM.
const INJECTION_PATTERNS: RegExp[] = [
  /ignore (?:all |any |the )?(?:previous|prior|above|earlier) (?:instructions|prompts?|rules)/i,
  /disregard (?:all |any |the )?(?:previous|prior|above|your) (?:instructions|prompts?|rules)/i,
  /(?:reveal|show|print|repeat|output|leak).{0,40}(?:system|hidden|developer|initial) (?:prompt|instructions?|message)/i,
  /\byou are now\b.{0,40}\b(?:dan|unrestricted|jailbroken|developer mode)\b/i,
  /\b(?:jailbreak|dan mode|developer mode)\b/i,
  /<\|?(?:system|im_start|im_end)\|?>/i,
];

export function detectInjectionHeuristic(text: string): boolean {
  return INJECTION_PATTERNS.some((p) => p.test(text));
}

export interface InputCheck {
  allowed: boolean;
  reason?: 'too_long' | 'prompt_injection';
  sanitized: string; // PII-redacted text: this is what the rest of the pipeline sees
  piiFound: string[];
}

@Injectable()
export class InputGuard {
  private readonly logger = new Logger(InputGuard.name);

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly llm: LlmService,
    private readonly pii: PiiRedactor,
  ) {}

  async check(text: string): Promise<InputCheck> {
    // 1) size limit: bounds cost and blocks "paste a novel" attacks
    if (text.length > MAX_INPUT_CHARS) {
      return { allowed: false, reason: 'too_long', sanitized: text.slice(0, MAX_INPUT_CHARS), piiFound: [] };
    }

    // 2) PII scrub before anything leaves our server
    const { text: sanitized, found } = this.pii.redact(text);

    // 3) deterministic injection patterns
    if (detectInjectionHeuristic(sanitized)) {
      return { allowed: false, reason: 'prompt_injection', sanitized, piiFound: found };
    }

    // 4) LLM classifier for what regexes miss (cheap model, tiny prompt, structured output)
    if (this.config.get('LLM_INPUT_GUARD', { infer: true })) {
      try {
        const verdict = await this.llm.structured({
          tier: 'fast',
          purpose: 'input_guard',
          schemaName: 'injection_check',
          schema: InjectionSchema,
          system: PROMPTS.injection,
          user: sanitized,
        });
        if (verdict.is_attack) {
          this.logger.warn(`blocked by classifier: ${verdict.reason}`);
          return { allowed: false, reason: 'prompt_injection', sanitized, piiFound: found };
        }
      } catch (err) {
        // Fail open on classifier outage: heuristics + the answer-side guard still protect us.
        this.logger.warn(`input classifier failed, continuing: ${(err as Error).message}`);
      }
    }
    return { allowed: true, sanitized, piiFound: found };
  }
}
