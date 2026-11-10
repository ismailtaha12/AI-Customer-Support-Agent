# ADR 003: Model routing, caching and layered guardrails

**Model routing.** Classification, rewriting, grading, guards and ticket drafting use the *fast* model with small
structured outputs. Only the final answer uses the *smart* model, with trimmed context and a token cap.

**Avoiding calls entirely.** Rewrite is skipped when the question already stands alone; grading is skipped when
retrieval returns nothing; embeddings are memoised in-process; verified FAQ answers go to a semantic cache.

**Guardrails are layered, cheapest first.** Input: length limit → PII redaction → injection regexes → LLM classifier.
Tools: per-intent allowlist, argument validation, RLS on every read. Output: PII redaction → citation validity →
groundedness check. The input classifier fails open (regex + output guard still protect); the groundedness check
fails closed (an unverifiable factual answer is replaced by a safe fallback).

**What is deliberately not cached.** Anything produced by tools (customer-specific data) and anything not grounded.

**Observability.** LangSmith traces carry prompt version and model names; `llm_usage` rows make cost and p50/p95
latency per step queryable in SQL (`GET /usage/summary`).
