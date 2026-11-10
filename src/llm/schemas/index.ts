import { z } from 'zod';

// Zod schemas for OpenAI Structured Outputs. The model is forced to return JSON that
// matches these, so we never regex-parse free text. (Structured Outputs requires every
// field to be present, so "optional" fields are modelled as .nullable().)

export const CATEGORIES = ['billing', 'appointments', 'privacy', 'technical'] as const;
export const INTENTS = ['faq', 'account', 'complaint', 'off_topic'] as const;
export type Category = (typeof CATEGORIES)[number];
export type Intent = (typeof INTENTS)[number];

// Router: what is the customer trying to do?
export const IntentSchema = z.object({
  intent: z.enum(INTENTS),
  category: z.enum(CATEGORIES).nullable(), // used as a metadata filter for FAQ retrieval
});

// Query rewriting: make a follow-up question understandable on its own
export const RewriteSchema = z.object({
  standalone_query: z.string(),
});

// Self-check: is the retrieved context enough to answer?
export const GradeSchema = z.object({
  sufficient: z.boolean(),
  reason: z.string(),
});

// Output guard: is every claim in the answer supported by the context?
export const GroundednessSchema = z.object({
  grounded: z.boolean(),
  unsupported_claims: z.array(z.string()),
});

// Input guard: is the message an attack on the assistant?
export const InjectionSchema = z.object({
  is_attack: z.boolean(),
  reason: z.string(),
});

// Escalation: summarise the problem for the human agent
export const TicketDraftSchema = z.object({
  subject: z.string(),
  summary: z.string(),
  priority: z.enum(['low', 'normal', 'high']),
});

// Eval judge (used by evals/ only)
export const JudgeSchema = z.object({
  faithful: z.boolean(), // answer only uses facts from the context
  correct: z.boolean(), // answer agrees with the reference answer
  reasoning: z.string(),
});
