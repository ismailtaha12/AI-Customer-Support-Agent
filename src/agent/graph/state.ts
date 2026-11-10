import { Annotation } from '@langchain/langgraph';
import type { ChatTurn, Citation, ToolCallLog } from '../../common/types';
import type { Category, Intent } from '../../llm/schemas';
import type { SearchHit } from '../../retrieval/stores/vector-store.interface';

// "Last write wins" channel with a default. Nodes return only the fields they change.
const last = <T>(init: () => T) => Annotation<T>({ reducer: (_old: T, next: T) => next, default: init });

export type AnswerSource = 'rag' | 'cache' | 'tools' | 'escalation' | 'static';

// The state flowing through the graph. Keep it small and serialisable: it shows up in LangSmith traces.
// (Embeddings and per-request clients deliberately live elsewhere.)
export const SupportState = Annotation.Root({
  // input
  question: last(() => ''),
  history: last<ChatTurn[]>(() => []),
  // guard + routing
  blocked: last<string | null>(() => null),
  intent: last<Intent | null>(() => null),
  category: last<Category | null>(() => null),
  // retrieval loop
  standaloneQuery: last(() => ''),
  attempts: last(() => 0),
  contexts: last<SearchHit[]>(() => []),
  sufficient: last(() => false),
  // output
  answer: last(() => ''),
  answerSource: last<AnswerSource>(() => 'static'),
  citations: last<Citation[]>(() => []),
  grounded: last(() => true),
  flags: last<string[]>(() => []),
  // side effects
  toolCalls: last<ToolCallLog[]>(() => []),
  escalated: last(() => false),
  ticketId: last<string | null>(() => null),
});

export type SupportStateType = typeof SupportState.State;
