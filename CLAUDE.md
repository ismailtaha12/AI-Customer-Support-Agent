# CLAUDE.md: conventions for AI-assisted development in this repo

This project was built with AI assistance (Claude). These rules keep that assistance reliable.

## Architecture rules
- All LLM and embedding calls go through `src/llm/llm.service.ts`. Never import `openai` anywhere else.
  (Usage logging, model routing, retries and LangSmith tracing live there.)
- Prompts live in `src/llm/prompts/index.ts`. Changing a prompt means bumping `PROMPT_VERSION`.
- Structured outputs use zod schemas in `src/llm/schemas`. Never regex-parse model text.
- Vector DBs implement `VectorStore`; the agent never talks to a specific database.
- The graph's routing decisions are pure functions in `agent/graph/routing.ts` (unit-tested without an LLM).
- Customer data is read/written with `SupabaseService.forUser()` (RLS applies); the service-role client is for
  ingestion, usage logging and the cache only.

## Definition of done for a change
1. `npm run typecheck` and `npm test` pass.
2. Anything that changes retrieval, prompts or the graph: run `npm run eval` and compare to `docs/eval-results.md`.
3. New guardrail or tool? Add a trajectory test in `test/agent/support-graph.spec.ts`.

## How AI output is verified (not trusted)
- Generated code is type-checked, unit-tested and boot-tested before it's accepted.
- Agent behaviour is tested two ways: scripted-LLM trajectory tests (deterministic, free) and a live eval (real model).
- Model-facing numbers (prices in `cost.calculator.ts`) are labelled illustrative and must be checked against the provider.
