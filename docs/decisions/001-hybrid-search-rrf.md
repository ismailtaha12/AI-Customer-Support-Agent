# ADR 001: Hybrid search fused with Reciprocal Rank Fusion, inside Postgres

**Context.** Semantic search misses exact terms (fee amounts, product names, "Meeza"); keyword search misses paraphrases
("not turning up" vs "no-show"). Support questions need both.

**Decision.** One SQL function (`hybrid_search`) runs a pgvector cosine search and a Postgres full-text search, then fuses the
two ranked lists with RRF (`score = Σ 1/(60 + rank)`). The metadata filter is applied before both retrievers.

**Why RRF.** It uses ranks, not scores, so there is no need to normalise cosine similarity against `ts_rank` (different scales).
No tuning weights; robust default.

**Why in SQL.** One round trip, no extra search service, and the same database already holds the rows and RLS.

**Trade-offs.** No cross-encoder reranker yet (next step if hit@1 lags hit@3). Keyword side uses an OR-query of stemmed terms
so natural-language questions still match.

**How we know it works.** `npm run eval` section A compares hybrid pgvector with dense-only Chroma on the same questions.
