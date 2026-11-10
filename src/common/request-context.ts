import { AsyncLocalStorage } from 'node:async_hooks';
import type { SupabaseClient } from '@supabase/supabase-js';

// Per-request state that deep code (LLM calls, tools) needs but that we don't want to
// thread through every function signature or keep in the LangGraph state.
export interface RequestContext {
  userId?: string;
  conversationId?: string;
  userClient?: SupabaseClient; // Supabase client acting AS the user (RLS applies)
  usageTotals?: { calls: number; promptTokens: number; completionTokens: number; costUsd: number };
}

export const requestContext = new AsyncLocalStorage<RequestContext>();
export const getCtx = (): RequestContext => requestContext.getStore() ?? {};
