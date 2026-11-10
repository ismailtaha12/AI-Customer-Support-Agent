import { Injectable } from '@nestjs/common';
import type { ChatTurn } from '../common/types';
import { LlmService } from '../llm/llm.service';
import { PROMPT_VERSION } from '../llm/prompts';
import { SupportGraphFactory } from './graph/support.graph';
import type { SupportStateType } from './graph/state';

export interface RunOptions {
  conversationId?: string;
  onNode?: (node: string, update: Record<string, unknown>) => void; // called as each graph node finishes (SSE progress)
}

@Injectable()
export class AgentService {
  private readonly graph: ReturnType<SupportGraphFactory['build']>;

  constructor(
    factory: SupportGraphFactory,
    private readonly llm: LlmService,
  ) {
    this.graph = factory.build(); // compile once at startup
  }

  /** Run one conversation turn through the graph and return the final state. */
  async run(input: { question: string; history: ChatTurn[] }, opts: RunOptions = {}): Promise<SupportStateType> {
    const stream = await this.graph.stream(input, {
      streamMode: ['updates', 'values'],
      // These end up on the LangSmith trace: filter and compare runs by prompt version / model.
      runName: 'support_turn',
      tags: ['support-agent', `prompts-${PROMPT_VERSION}`],
      metadata: {
        conversationId: opts.conversationId,
        promptVersion: PROMPT_VERSION,
        fastModel: this.llm.modelFor('fast'),
        smartModel: this.llm.modelFor('smart'),
        // userId is deliberately NOT sent to LangSmith (privacy)
      },
    });

    let finalState: SupportStateType | undefined;
    for await (const [mode, chunk] of stream) {
      if (mode === 'updates') {
        for (const [node, update] of Object.entries(chunk as Record<string, Record<string, unknown>>)) opts.onNode?.(node, update ?? {});
      } else {
        finalState = chunk as SupportStateType;
      }
    }
    if (!finalState) throw new Error('Graph produced no state');
    return finalState;
  }
}
