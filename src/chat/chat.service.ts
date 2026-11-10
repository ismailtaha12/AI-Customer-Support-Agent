import { Injectable, NotFoundException } from '@nestjs/common';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AgentService } from '../agent/agent.service';
import { summarizeStep, type StepDetail } from '../agent/graph/step-summary';
import type { AuthedUser } from '../auth/auth.guard';
import { requestContext, type RequestContext } from '../common/request-context';
import type { ChatTurn, Citation, ToolCallLog } from '../common/types';
import { SupabaseService } from '../supabase/supabase.service';

export interface ChatInput {
  message: string;
  conversationId?: string;
}

export interface ChatResult {
  conversationId: string;
  answer: string;
  intent: string | null;
  citations: Citation[];
  escalated: boolean;
  ticketId: string | null;
  toolCalls: ToolCallLog[];
  answerSource: string;
  flags: string[];
  usage: { calls: number; promptTokens: number; completionTokens: number; costUsd: number };
  latencyMs: number;
}

@Injectable()
export class ChatService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly agent: AgentService,
  ) {}

  async execute(user: AuthedUser, input: ChatInput, onStep?: (node: string, detail: StepDetail) => void): Promise<ChatResult> {
    const started = Date.now();
    // Everything below talks to the DB AS THE USER, so RLS protects their data.
    const userClient = this.supabase.forUser(user.accessToken);

    const isNew = !input.conversationId;
    const conversationId = input.conversationId ?? (await this.createConversation(userClient, user.id));
    const history = isNew ? [] : await this.loadHistory(userClient, conversationId);

    const ctx: RequestContext = {
      userId: user.id,
      conversationId,
      userClient,
      usageTotals: { calls: 0, promptTokens: 0, completionTokens: 0, costUsd: 0 },
    };

    // AsyncLocalStorage: LLM calls and tools deep inside the graph can read ctx (usage logging, RLS client)
    const state = await requestContext.run(ctx, () =>
      this.agent.run({ question: input.message, history }, { conversationId, onNode: onStep && ((node, update) => onStep(node, summarizeStep(node, update))) }),
    );

    // Persist the turn. `state.question` is the PII-redacted version of what the user typed.
    const { error } = await userClient.from('messages').insert([
      { conversation_id: conversationId, role: 'user', content: state.question },
      {
        conversation_id: conversationId,
        role: 'assistant',
        content: state.answer,
        metadata: {
          intent: state.intent,
          citations: state.citations,
          toolCalls: state.toolCalls,
          escalated: state.escalated,
          ticketId: state.ticketId,
          flags: state.flags,
        },
      },
    ]);
    if (error) throw new Error(`saving messages failed: ${error.message}`);
    if (isNew) await userClient.from('conversations').update({ title: state.question.slice(0, 60) }).eq('id', conversationId);

    return {
      conversationId,
      answer: state.answer,
      intent: state.intent,
      citations: state.citations,
      escalated: state.escalated,
      ticketId: state.ticketId,
      toolCalls: state.toolCalls,
      answerSource: state.answerSource,
      flags: state.flags,
      usage: ctx.usageTotals!,
      latencyMs: Date.now() - started,
    };
  }

  private async createConversation(client: SupabaseClient, userId: string): Promise<string> {
    const { data, error } = await client.from('conversations').insert({ user_id: userId }).select('id').single();
    if (error) throw new Error(`creating conversation failed: ${error.message}`);
    return data.id;
  }

  // Last 6 messages, oldest first. RLS returns nothing for someone else's conversation.
  private async loadHistory(client: SupabaseClient, conversationId: string): Promise<ChatTurn[]> {
    const { data: conv } = await client.from('conversations').select('id').eq('id', conversationId).maybeSingle();
    if (!conv) throw new NotFoundException('Conversation not found');

    const { data } = await client
      .from('messages')
      .select('role, content')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(6);
    return ((data ?? []) as ChatTurn[]).reverse();
  }
}
