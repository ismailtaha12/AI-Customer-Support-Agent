import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { wrapOpenAI } from 'langsmith/wrappers'; // makes every OpenAI call show up in LangSmith
import { z } from 'zod';
import type { Env } from '../config/env';
import { UsageService } from '../observability/usage.service';

export type ModelTier = 'fast' | 'smart';
type Message = OpenAI.Chat.ChatCompletionMessageParam;

export interface ChatOptions {
  tier: ModelTier;
  purpose: string; // label used in usage logs and traces
  messages: Message[];
  tools?: OpenAI.Chat.ChatCompletionTool[];
  maxTokens?: number;
  temperature?: number;
}

export interface StructuredOptions<S extends z.ZodTypeAny> {
  tier: ModelTier;
  purpose: string;
  system: string;
  user: string;
  schema: S;
  schemaName: string;
}

const EMBED_BATCH = 96;
const EMBED_CACHE_MAX = 500;

// The single gateway to the LLM provider: model routing, structured outputs, embeddings,
// retries/timeouts, in-memory embedding memo, and usage logging live here and nowhere else.
@Injectable()
export class LlmService {
  private readonly client: OpenAI;
  private readonly embedMemo = new Map<string, number[]>(); // tiny LRU (Map keeps insertion order)

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly usage: UsageService,
  ) {
    this.client = wrapOpenAI(
      new OpenAI({ apiKey: this.config.get('OPENAI_API_KEY', { infer: true }), maxRetries: 3, timeout: 30_000 }),
    );
  }

  // Cost optimisation: cheap model for routing/grading/guards, strong model only for the final answer.
  modelFor(tier: ModelTier): string {
    return this.config.get(tier === 'smart' ? 'CHAT_MODEL' : 'FAST_MODEL', { infer: true });
  }

  /** Plain chat completion (also used for tool calling: pass `tools`). */
  async chat(opts: ChatOptions): Promise<OpenAI.Chat.ChatCompletionMessage> {
    const model = this.modelFor(opts.tier);
    const started = Date.now();
    const res = await this.client.chat.completions.create({
      model,
      messages: opts.messages,
      tools: opts.tools?.length ? opts.tools : undefined,
      temperature: opts.temperature ?? 0, // remove if you switch to a reasoning model
      max_completion_tokens: opts.maxTokens ?? 600, // hard cap on output tokens = bounded cost
    });
    this.logUsage(opts.purpose, model, res.usage, started);
    return res.choices[0].message;
  }

  /** Chat completion whose output is forced to match a zod schema (Structured Outputs). */
  async structured<S extends z.ZodTypeAny>(opts: StructuredOptions<S>): Promise<z.infer<S>> {
    const model = this.modelFor(opts.tier);
    const started = Date.now();
    const res = await this.client.chat.completions.parse({
      model,
      messages: [
        { role: 'system', content: opts.system },
        { role: 'user', content: opts.user },
      ],
      response_format: zodResponseFormat(opts.schema, opts.schemaName),
      temperature: 0,
      max_completion_tokens: 400,
    });
    this.logUsage(opts.purpose, model, res.usage, started);

    const parsed = res.choices[0].message.parsed;
    if (!parsed) throw new Error(`Structured output empty or refused (${opts.purpose})`);
    return parsed as z.infer<S>;
  }

  /** Embeddings: batched, and repeated texts are served from memory (e.g. the same query is embedded for cache + retrieval). */
  async embed(texts: string[]): Promise<number[][]> {
    const model = this.config.get('EMBEDDING_MODEL', { infer: true });
    const out: number[][] = new Array(texts.length);
    const missing: { index: number; text: string }[] = [];

    texts.forEach((text, index) => {
      const hit = this.embedMemo.get(text);
      if (hit) out[index] = hit;
      else missing.push({ index, text });
    });

    for (let i = 0; i < missing.length; i += EMBED_BATCH) {
      const batch = missing.slice(i, i + EMBED_BATCH);
      const started = Date.now();
      const res = await this.client.embeddings.create({ model, input: batch.map((b) => b.text) });
      this.logUsage('embed', model, { prompt_tokens: res.usage.prompt_tokens, completion_tokens: 0 }, started);
      res.data.forEach((d, j) => {
        out[batch[j].index] = d.embedding;
        this.remember(batch[j].text, d.embedding);
      });
    }
    return out;
  }

  private remember(text: string, vector: number[]) {
    if (this.embedMemo.size >= EMBED_CACHE_MAX) this.embedMemo.delete(this.embedMemo.keys().next().value as string);
    this.embedMemo.set(text, vector);
  }

  private logUsage(
    purpose: string,
    model: string,
    usage: { prompt_tokens?: number; completion_tokens?: number } | undefined,
    startedAt: number,
  ) {
    this.usage.record({
      purpose,
      model,
      promptTokens: usage?.prompt_tokens ?? 0,
      completionTokens: usage?.completion_tokens ?? 0,
      latencyMs: Date.now() - startedAt,
    });
  }
}
