import 'reflect-metadata';
// Fair measurement: a warm cache would hide retrieval/generation quality, so disable it for evals.
// (Set BEFORE Nest boots; ConfigModule does not override variables that are already set.)
process.env.SEMANTIC_CACHE = 'false';

import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { traceable } from 'langsmith/traceable';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { AgentService } from '../src/agent/agent.service';
import { AppModule } from '../src/app.module';
import { requestContext } from '../src/common/request-context';
import type { Env } from '../src/config/env';
import { InputGuard } from '../src/guardrails/input.guard';
import { LlmService } from '../src/llm/llm.service';
import { PROMPT_VERSION } from '../src/llm/prompts';
import { RetrievalService } from '../src/retrieval/retrieval.service';
import { ChromaStore } from '../src/retrieval/stores/chroma.store';
import { PgVectorStore } from '../src/retrieval/stores/pgvector.store';
import type { VectorStore } from '../src/retrieval/stores/vector-store.interface';
import { judgeAnswer } from './evaluators/judge';
import { scoreRetrieval, summarize } from './evaluators/retrieval';

interface Golden { id: string; question: string; reference: string; expectedTitle: string | null; answerable: boolean }
interface Adversarial { id: string; message: string; expect: 'blocked' | 'allowed' }
interface Trajectory { id: string; message: string; expectedIntent: string; expectedTools: string[]; expectEscalation: boolean }

const readJsonl = async <T>(file: string): Promise<T[]> =>
  (await fs.readFile(path.join(__dirname, 'datasets', file), 'utf8')).split('\n').filter(Boolean).map((l) => JSON.parse(l));

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
const mdTable = (rows: Record<string, string | number>[]) => {
  const cols = Object.keys(rows[0] ?? {});
  return [`| ${cols.join(' | ')} |`, `| ${cols.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${cols.map((c) => r[c]).join(' | ')} |`)].join('\n');
};

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const config = app.get(ConfigService<Env, true>);
  const llm = app.get(LlmService);
  const retrieval = app.get(RetrievalService);
  const agent = app.get(AgentService);
  const inputGuard = app.get(InputGuard);
  const sections: string[] = [];

  const golden = await readJsonl<Golden>('golden-qa.jsonl');
  const answerable = golden.filter((g) => g.answerable && g.expectedTitle);

  // ───────────── A. Retrieval quality (no LLM generation involved) ─────────────
  const stores: VectorStore[] = [app.get(PgVectorStore)];
  if (app.get(ChromaStore).enabled) stores.push(app.get(ChromaStore));

  const retrievalRows = [];
  for (const store of stores) {
    const scores = [];
    for (const g of answerable) {
      const hits = await retrieval.retrieveFrom(store, { query: g.question, k: 5 });
      scores.push(scoreRetrieval(hits, g.expectedTitle!));
    }
    const s = summarize(scores);
    retrievalRows.push({ store: store.name, questions: s.n, 'hit@1': pct(s['hit@1']), 'hit@3': pct(s['hit@3']), MRR: s.MRR.toFixed(2) });
  }
  sections.push('## A. Retrieval (no filters, top-5)\n\n' + mdTable(retrievalRows));

  // ───────────── B. End-to-end answers, judged by an LLM ─────────────
  const e2e: { id: string; pass: boolean; note: string; latencyMs: number; costUsd: number; tokens: number }[] = [];
  for (const g of golden) {
    const totals = { calls: 0, promptTokens: 0, completionTokens: 0, costUsd: 0 };
    const started = Date.now();
    const state = await requestContext.run({ usageTotals: totals }, () => agent.run({ question: g.question, history: [] }));
    const latencyMs = Date.now() - started;

    let pass: boolean;
    let note = '';
    if (g.answerable) {
      const verdict = await judgeAnswer(llm, {
        question: g.question,
        reference: g.reference,
        context: state.contexts.map((c, i) => `[${i + 1}] ${c.content}`).join('\n'),
        answer: state.answer,
      });
      pass = verdict.faithful && verdict.correct && state.citations.length > 0;
      note = `faithful=${verdict.faithful} correct=${verdict.correct} cited=${state.citations.length > 0}`;
    } else {
      // Unanswerable: the right behaviour is to NOT present a cited, confident answer.
      pass = state.citations.length === 0;
      note = state.escalated ? 'escalated' : 'declined';
    }
    e2e.push({ id: g.id, pass, note, latencyMs, costUsd: totals.costUsd, tokens: totals.promptTokens + totals.completionTokens });
  }
  const mean = (f: (r: (typeof e2e)[number]) => number) => e2e.reduce((a, r) => a + f(r), 0) / (e2e.length || 1);
  const sorted = [...e2e].sort((a, b) => a.latencyMs - b.latencyMs);
  sections.push(
    '## B. End-to-end answers (LLM judge)\n\n' +
      mdTable([
        {
          questions: e2e.length,
          'pass rate': pct(mean((r) => Number(r.pass))),
          'avg latency': `${Math.round(mean((r) => r.latencyMs))} ms`,
          'p95 latency': `${sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]?.latencyMs ?? 0} ms`,
          'avg tokens': Math.round(mean((r) => r.tokens)),
          'avg cost / question': `$${mean((r) => r.costUsd).toFixed(5)}`,
        },
      ]) +
      '\n\n' + mdTable(e2e.map((r) => ({ id: r.id, result: r.pass ? 'PASS' : 'FAIL', detail: r.note }))),
  );

  // ───────────── C. Guardrails ─────────────
  const adversarial = await readJsonl<Adversarial>('adversarial.jsonl');
  const guardResults = [];
  for (const a of adversarial) {
    const r = await inputGuard.check(a.message);
    guardResults.push({ ...a, blocked: !r.allowed });
  }
  const attacks = guardResults.filter((r) => r.expect === 'blocked');
  const safe = guardResults.filter((r) => r.expect === 'allowed');
  sections.push(
    '## C. Input guardrails\n\n' +
      mdTable([
        {
          'attacks blocked': `${attacks.filter((r) => r.blocked).length}/${attacks.length}`,
          'false positives': `${safe.filter((r) => r.blocked).length}/${safe.length}`,
        },
      ]) +
      '\n\nMissed attacks: ' + (attacks.filter((r) => !r.blocked).map((r) => r.id).join(', ') || 'none'),
  );

  // ───────────── D. Agent trajectories ─────────────
  const trajectories = await readJsonl<Trajectory>('trajectories.jsonl');
  const trajRows = [];
  for (const t of trajectories) {
    const state = await agent.run({ question: t.message, history: [] }); // no user context: tools return empty data, tickets are dry-run
    const tools = [...new Set(state.toolCalls.map((c) => c.name))].sort();
    const toolsOk = JSON.stringify(tools) === JSON.stringify([...t.expectedTools].sort());
    const intentOk = state.intent === t.expectedIntent;
    const escOk = state.escalated === t.expectEscalation;
    trajRows.push({ id: t.id, result: toolsOk && intentOk && escOk ? 'PASS' : 'FAIL', intent: `${state.intent} (want ${t.expectedIntent})`, tools: tools.join(',') || '-', escalated: String(state.escalated) });
  }
  sections.push('## D. Agent trajectories (live model)\n\n' + mdTable(trajRows));

  // ───────────── report ─────────────
  const header =
    `# Eval results\n\n` +
    `- Date: ${new Date().toISOString()}\n- Prompt version: ${PROMPT_VERSION}\n` +
    `- Models: smart=${llm.modelFor('smart')}, fast=${llm.modelFor('fast')}\n` +
    `- Contextual retrieval at ingest: ${config.get('CONTEXTUAL_RETRIEVAL', { infer: true })}\n` +
    `- Active vector store: ${config.get('VECTOR_STORE', { infer: true })}\n`;
  const report = [header, ...sections].join('\n\n') + '\n';
  console.log('\n' + report);
  await fs.writeFile(path.join(__dirname, '..', 'docs', 'eval-results.md'), report);
  await app.close();
}

// Wrapping in traceable() groups every LLM call of the run under one LangSmith trace
traceable(main, { name: 'eval_run', tags: ['eval'] })().catch((e) => {
  console.error(e);
  process.exit(1);
});
