import { Injectable, Logger } from '@nestjs/common';
import { getCtx } from '../common/request-context';
import { SupabaseService } from '../supabase/supabase.service';
import { estimateCostUsd } from './cost.calculator';

export interface UsageEvent {
  purpose: string; // which step made the call: classify, generate, embed, ...
  model: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
}

// Records every LLM/embedding call so we can answer "what does a conversation cost?"
// and "which step is slow?". Complements LangSmith traces with queryable SQL.
@Injectable()
export class UsageService {
  private readonly logger = new Logger(UsageService.name);

  constructor(private readonly supabase: SupabaseService) {}

  record(e: UsageEvent): void {
    const ctx = getCtx();
    const costUsd = estimateCostUsd(e.model, e.promptTokens, e.completionTokens);

    // Running total for the current request (returned to the client in the chat response)
    if (ctx.usageTotals) {
      ctx.usageTotals.calls += 1;
      ctx.usageTotals.promptTokens += e.promptTokens;
      ctx.usageTotals.completionTokens += e.completionTokens;
      ctx.usageTotals.costUsd += costUsd;
    }

    // Fire-and-forget: logging must never slow down or break a user's answer
    void Promise.resolve(
      this.supabase.admin.from('llm_usage').insert({
        conversation_id: ctx.conversationId ?? null,
        purpose: e.purpose,
        model: e.model,
        prompt_tokens: e.promptTokens,
        completion_tokens: e.completionTokens,
        cost_usd: costUsd,
        latency_ms: e.latencyMs,
      }),
    ).then(({ error }) => {
      if (error) this.logger.warn(`usage insert failed: ${error.message}`);
    });
  }

  // Backing data for GET /usage/summary
  async summary() {
    const [latency, perConversation] = await Promise.all([
      this.supabase.admin.from('llm_latency_by_purpose').select('*'),
      this.supabase.admin.from('llm_cost_per_conversation').select('*').order('cost_usd', { ascending: false }).limit(20),
    ]);
    return { byPurpose: latency.data ?? [], topConversations: perConversation.data ?? [] };
  }
}
