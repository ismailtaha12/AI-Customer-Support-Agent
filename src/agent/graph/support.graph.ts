import { Injectable, Logger } from '@nestjs/common';
import { END, START, StateGraph } from '@langchain/langgraph';
import type OpenAI from 'openai';
import { SemanticCacheService } from '../../cache/semantic-cache.service';
import type { ChatTurn, ToolCallLog } from '../../common/types';
import { InputGuard, MAX_INPUT_CHARS } from '../../guardrails/input.guard';
import { OutputGuard } from '../../guardrails/output.guard';
import { LlmService } from '../../llm/llm.service';
import { PROMPTS } from '../../llm/prompts';
import { GradeSchema, IntentSchema, TicketDraftSchema } from '../../llm/schemas';
import { QueryRewriter } from '../../retrieval/query-rewriter.service';
import { RetrievalService } from '../../retrieval/retrieval.service';
import type { SearchHit } from '../../retrieval/stores/vector-store.interface';
import { TicketsService } from '../../tickets/tickets.service';
import { ToolRegistry } from '../tools/tool-registry';
import { routeAfterClassify, routeAfterGrade, routeAfterGuard, routeAfterRetrieve } from './routing';
import { SupportState, type SupportStateType } from './state';

type Update = Partial<SupportStateType>;

const MAX_TOOL_STEPS = 4; // hard stop on the tool loop: no runaway agents
const MAX_CONTEXT_CHARS = 6000; // ~1500 tokens of context: bounds cost per answer

const history = (turns: ChatTurn[]) =>
  turns.length ? turns.slice(-6).map((t) => `${t.role}: ${t.content}`).join('\n') : '(none)';

const numbered = (hits: SearchHit[]) => hits.map((h, i) => `[${i + 1}] (${h.title})\n${h.content}`).join('\n\n');

// Token-budget guard: keep the best-ranked passages until the character budget is used up.
export function trimToBudget(hits: SearchHit[], maxChars = MAX_CONTEXT_CHARS): SearchHit[] {
  const kept: SearchHit[] = [];
  let used = 0;
  for (const h of hits) {
    if (kept.length && used + h.content.length > maxChars) break;
    kept.push(h);
    used += h.content.length;
  }
  return kept;
}

@Injectable()
export class SupportGraphFactory {
  private readonly logger = new Logger(SupportGraphFactory.name);

  constructor(
    private readonly llm: LlmService,
    private readonly retrieval: RetrievalService,
    private readonly rewriter: QueryRewriter,
    private readonly cache: SemanticCacheService,
    private readonly inputGuard: InputGuard,
    private readonly outputGuard: OutputGuard,
    private readonly tools: ToolRegistry,
    private readonly tickets: TicketsService,
  ) {}

  // ───────────────────────────────── nodes ─────────────────────────────────

  // 1. Input guardrails: size limit, PII scrub, prompt-injection checks.
  private inputGuardNode = async (s: SupportStateType): Promise<Update> => {
    const r = await this.inputGuard.check(s.question);
    return {
      question: r.sanitized, // downstream nodes only ever see the redacted text
      blocked: r.allowed ? null : (r.reason ?? 'blocked'),
      flags: r.piiFound.length ? ['pii_redacted_input'] : [],
    };
  };

  // 2. Router: structured output -> intent (+ category used as a retrieval filter).
  private classifyNode = async (s: SupportStateType): Promise<Update> => {
    const r = await this.llm.structured({
      tier: 'fast',
      purpose: 'classify',
      schemaName: 'intent',
      schema: IntentSchema,
      system: PROMPTS.classify,
      user: `Conversation:\n${history(s.history)}\n\nLatest message: ${s.question}`,
    });
    return { intent: r.intent, category: r.category };
  };

  // 3. Query rewriting (skipped when the question already stands alone).
  private rewriteNode = async (s: SupportStateType): Promise<Update> => ({
    standaloneQuery: await this.rewriter.rewrite(s.question, s.history, s.attempts),
  });

  // 4. Retrieval: semantic cache first, then hybrid search with a metadata filter.
  private retrieveNode = async (s: SupportStateType): Promise<Update> => {
    if (s.attempts === 0) {
      const hit = await this.cache.get(s.standaloneQuery);
      if (hit) {
        return { answer: hit.answer, citations: hit.citations, answerSource: 'cache', contexts: [] };
      }
    }
    // First try is narrowed by category (precision). On retry we drop the filter (recall),
    // in case the classifier picked the wrong category.
    const filters = s.attempts === 0 && s.category ? { category: s.category } : undefined;
    const contexts = await this.retrieval.retrieve({ query: s.standaloneQuery, filters, k: 5 });
    return { contexts, answerSource: 'rag' };
  };

  // 5. Self-check: are the passages good enough? (Skips the LLM call if nothing was found.)
  private gradeNode = async (s: SupportStateType): Promise<Update> => {
    if (!s.contexts.length) return { sufficient: false, attempts: s.attempts + 1 };
    const r = await this.llm.structured({
      tier: 'fast',
      purpose: 'grade',
      schemaName: 'grade',
      schema: GradeSchema,
      system: PROMPTS.grade,
      user: `Question: ${s.standaloneQuery}\n\nPassages:\n${numbered(s.contexts)}`,
    });
    return r.sufficient ? { sufficient: true } : { sufficient: false, attempts: s.attempts + 1 };
  };

  // 6. Generate: the only call that uses the strong model, with a trimmed context.
  private generateNode = async (s: SupportStateType): Promise<Update> => {
    const contexts = trimToBudget(s.contexts);
    const msg = await this.llm.chat({
      tier: 'smart',
      purpose: 'generate',
      maxTokens: 400,
      messages: [
        { role: 'system', content: PROMPTS.answer },
        // standalone query instead of the whole chat history: fewer tokens, same meaning
        { role: 'user', content: `Context:\n${numbered(contexts)}\n\nQuestion: ${s.standaloneQuery}` },
      ],
    });
    return { answer: (msg.content ?? '').trim(), contexts, answerSource: 'rag' };
  };

  // 7. Tool-calling loop for questions about the customer's own data.
  private toolAgentNode = async (s: SupportStateType): Promise<Update> => {
    const intent = s.intent ?? 'account';
    const toolDefs = this.tools.definitionsFor(intent);
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: PROMPTS.toolAgent },
      ...s.history.slice(-6).map((t) => ({ role: t.role, content: t.content }) as OpenAI.Chat.ChatCompletionMessageParam),
      { role: 'user', content: s.question },
    ];
    const toolCalls: ToolCallLog[] = [];
    let ticketId: string | null = null;

    for (let step = 0; step < MAX_TOOL_STEPS; step++) {
      const msg = await this.llm.chat({ tier: 'fast', purpose: 'tool_agent', messages, tools: toolDefs, maxTokens: 400 });
      messages.push(msg as OpenAI.Chat.ChatCompletionMessageParam);

      if (!msg.tool_calls?.length) {
        return { answer: (msg.content ?? '').trim(), answerSource: 'tools', toolCalls, ticketId, escalated: !!ticketId };
      }
      for (const call of msg.tool_calls) {
        if (call.type !== 'function') continue;
        const result = await this.tools.execute(intent, call.function.name, call.function.arguments);
        toolCalls.push({ name: call.function.name, args: safeJson(call.function.arguments) });
        if (call.function.name === 'create_ticket') ticketId = (result as { ticketId?: string | null })?.ticketId ?? null;
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
      }
    }
    return {
      answer: "I couldn't finish that request. I can open a ticket so a team member can follow up.",
      answerSource: 'tools',
      toolCalls,
    };
  };

  // 8. Human hand-off: draft the ticket with structured output, then create it.
  private escalateNode = async (s: SupportStateType): Promise<Update> => {
    const draft = await this.llm.structured({
      tier: 'fast',
      purpose: 'ticket_draft',
      schemaName: 'ticket_draft',
      schema: TicketDraftSchema,
      system: PROMPTS.ticketDraft,
      user: `Conversation:\n${history(s.history)}\n\nLatest message: ${s.question}`,
    });
    let ticketId: string | null = null;
    try {
      ticketId = (await this.tickets.create({ subject: draft.subject, description: draft.summary, priority: draft.priority })).id;
    } catch (err) {
      this.logger.error(`escalation failed: ${(err as Error).message}`);
    }
    const ref = ticketId ? ` (reference ${ticketId.slice(0, 8)})` : '';
    return {
      answer: `I've passed this to our support team${ref}. A team member will follow up by email.`,
      answerSource: 'escalation',
      escalated: true,
      ticketId,
    };
  };

  // 9. Output guardrails: PII scrub, citation check, groundedness check; then feed the cache.
  private outputGuardNode = async (s: SupportStateType): Promise<Update> => {
    const check = await this.outputGuard.check({
      answer: s.answer,
      contexts: s.contexts,
      verifyGrounding: s.answerSource === 'rag', // cached answers were verified when they were stored
    });
    const citations = s.answerSource === 'cache' ? s.citations : check.citations;

    // Only verified, document-backed answers are cached.
    if (s.answerSource === 'rag' && check.grounded && check.citations.length) {
      await this.cache.put(s.standaloneQuery, check.answer, check.citations);
    }
    return { answer: check.answer, citations, grounded: check.grounded, flags: [...s.flags, ...check.flags] };
  };

  // Terminal nodes without an LLM call
  private refuseNode = async (s: SupportStateType): Promise<Update> => ({
    answer:
      s.blocked === 'too_long'
        ? `Your message is too long. Please keep it under ${MAX_INPUT_CHARS} characters.`
        : 'I can only help with Nile Health support questions. Is there something about your appointments, billing or account I can help with?',
    answerSource: 'static',
    flags: [...s.flags, `blocked:${s.blocked}`],
  });

  private offTopicNode = async (): Promise<Update> => ({
    answer: 'I can help with appointments, billing, privacy and video visits at Nile Health. What do you need help with?',
    answerSource: 'static',
  });

  // ───────────────────────────────── wiring ─────────────────────────────────
  //
  //  START → inputGuard ─┬─ blocked ──────────────────────────→ refuse → END
  //                      └─ classify ─┬─ faq ───→ rewrite → retrieve ─┬─ cache hit ─────────────┐
  //                                   │                      ▲        └─ grade ─┬─ ok → generate ┤
  //                                   │                      └── retry once ───┤                │
  //                                   │                                         └─ fail → escalate
  //                                   ├─ account ───→ toolAgent ─────────────────────────────────┤
  //                                   ├─ complaint ─→ escalate ──────────────────────────────────┤
  //                                   └─ off_topic ─→ offTopic → END                             ↓
  //                                                                                       outputGuard → END
  build() {
    return new StateGraph(SupportState)
      .addNode('inputGuard', this.inputGuardNode)
      .addNode('refuse', this.refuseNode)
      .addNode('classify', this.classifyNode)
      .addNode('rewrite', this.rewriteNode)
      .addNode('retrieve', this.retrieveNode)
      .addNode('grade', this.gradeNode)
      .addNode('generate', this.generateNode)
      .addNode('toolAgent', this.toolAgentNode)
      .addNode('escalate', this.escalateNode)
      .addNode('offTopic', this.offTopicNode)
      .addNode('outputGuard', this.outputGuardNode)
      .addEdge(START, 'inputGuard')
      .addConditionalEdges('inputGuard', routeAfterGuard, ['refuse', 'classify'])
      .addConditionalEdges('classify', routeAfterClassify, ['rewrite', 'toolAgent', 'escalate', 'offTopic'])
      .addEdge('rewrite', 'retrieve')
      .addConditionalEdges('retrieve', routeAfterRetrieve, ['outputGuard', 'grade'])
      .addConditionalEdges('grade', routeAfterGrade, ['generate', 'rewrite', 'escalate'])
      .addEdge('generate', 'outputGuard')
      .addEdge('toolAgent', 'outputGuard')
      .addEdge('escalate', 'outputGuard')
      .addEdge('outputGuard', END)
      .addEdge('refuse', END)
      .addEdge('offTopic', END)
      .compile();
  }
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
