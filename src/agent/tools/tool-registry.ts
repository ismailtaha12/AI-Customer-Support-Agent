import { Injectable, Logger } from '@nestjs/common';
import { zodFunction } from 'openai/helpers/zod';
import type OpenAI from 'openai';
import { z } from 'zod';
import { AppointmentsService } from '../../appointments/appointments.service';
import type { Intent } from '../../llm/schemas';
import { RetrievalService } from '../../retrieval/retrieval.service';
import { TicketsService } from '../../tickets/tickets.service';

// ───────── Tool argument schemas (zod = validation AND the JSON schema the model sees) ─────────
export const ListAppointmentsArgs = z.object({
  when: z.enum(['upcoming', 'past', 'all']).describe('Which of the customer\'s appointments to list'),
});
export const SearchKbArgs = z.object({
  query: z.string().describe('What to look up in the help centre'),
});
export const CreateTicketArgs = z.object({
  subject: z.string(),
  description: z.string().describe('What the customer needs, in 1-3 sentences'),
  priority: z.enum(['low', 'normal', 'high']),
});

export type ToolName = 'list_appointments' | 'search_knowledge_base' | 'create_ticket';

// GUARDRAIL: which tools each intent may use. The router decides the intent, so a
// "complaint" can never trigger account lookups, whatever the model is tricked into asking.
export const INTENT_TOOL_ALLOWLIST: Record<Intent, ToolName[]> = {
  faq: [],
  account: ['list_appointments', 'search_knowledge_base', 'create_ticket'],
  complaint: [],
  off_topic: [],
};

interface ToolDef {
  name: ToolName;
  description: string;
  schema: z.ZodTypeAny;
  run: (args: any) => Promise<unknown>;
}

@Injectable()
export class ToolRegistry {
  private readonly logger = new Logger(ToolRegistry.name);
  private readonly tools: Record<ToolName, ToolDef>;

  constructor(
    appointments: AppointmentsService,
    tickets: TicketsService,
    retrieval: RetrievalService,
  ) {
    this.tools = {
      list_appointments: {
        name: 'list_appointments',
        description: "List the logged-in customer's appointments (doctor, time, status).",
        schema: ListAppointmentsArgs,
        run: (a: z.infer<typeof ListAppointmentsArgs>) => appointments.list(a.when),
      },
      search_knowledge_base: {
        name: 'search_knowledge_base',
        description: 'Search the Nile Health help centre for policies (cancellation, billing, privacy, video visits).',
        schema: SearchKbArgs,
        run: async (a: z.infer<typeof SearchKbArgs>) => {
          const hits = await retrieval.retrieve({ query: a.query, k: 3 });
          return hits.map((h) => ({ source: h.title, text: h.content }));
        },
      },
      create_ticket: {
        name: 'create_ticket',
        description: 'Open a support ticket for a human agent. Only when the customer needs a person to act.',
        schema: CreateTicketArgs,
        run: async (a: z.infer<typeof CreateTicketArgs>) => ({ ticketId: (await tickets.create(a)).id, status: 'open' }),
      },
    };
  }

  /** OpenAI tool definitions for the tools this intent may use. */
  definitionsFor(intent: Intent): OpenAI.Chat.ChatCompletionTool[] {
    return INTENT_TOOL_ALLOWLIST[intent].map((name) =>
      zodFunction({ name, description: this.tools[name].description, parameters: this.tools[name].schema as z.ZodObject<any> }),
    );
  }

  /** Validate + run one tool call. Errors are returned to the model as data, never thrown. */
  async execute(intent: Intent, name: string, rawArgs: string): Promise<unknown> {
    if (!(INTENT_TOOL_ALLOWLIST[intent] as string[]).includes(name)) {
      this.logger.warn(`blocked tool "${name}" for intent "${intent}"`);
      return { error: `Tool ${name} is not available.` };
    }
    const tool = this.tools[name as ToolName];

    let json: unknown;
    try {
      json = JSON.parse(rawArgs || '{}');
    } catch {
      return { error: 'Arguments were not valid JSON.' };
    }
    const parsed = tool.schema.safeParse(json);
    if (!parsed.success) return { error: `Invalid arguments: ${parsed.error.message}` };

    try {
      return await tool.run(parsed.data);
    } catch (err) {
      this.logger.error(`tool ${name} failed: ${(err as Error).message}`);
      return { error: 'The tool failed. Tell the customer you could not complete this and offer a ticket.' };
    }
  }
}
