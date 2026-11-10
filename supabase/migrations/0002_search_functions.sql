-- 0002: hybrid search (semantic + keyword, fused with Reciprocal Rank Fusion) and cache lookup

create or replace function hybrid_search(
  query_text       text,
  query_embedding  vector(1536),
  match_count      int   default 5,
  filter_metadata  jsonb default '{}',   -- metadata filtering: chunk.metadata must contain this
  rrf_k            int   default 60,     -- RRF damping constant (60 is the usual default)
  candidate_pool   int   default 20      -- how many candidates each retriever contributes
)
returns table (
  id uuid, document_id uuid, title text, content text,
  context text, metadata jsonb, score float
)
language sql stable
as $$
  -- 1) Metadata filter applied BEFORE ranking, so both retrievers respect it
  with filtered as (
    select c.id, c.document_id, c.content, c.context, c.embedding, c.fts, c.metadata, d.title
    from chunks c
    join documents d on d.id = c.document_id
    where c.metadata @> filter_metadata
  ),
  -- 2) Semantic retriever: cosine distance on the embedding
  semantic as (
    select id, row_number() over (order by embedding <=> query_embedding) as rnk
    from filtered
    order by embedding <=> query_embedding
    limit candidate_pool
  ),
  -- 3) Keyword retriever: OR-query built from the stemmed words of the question.
  --    (plain AND-matching returns nothing for natural-language questions)
  keyword as (
    select f.id, row_number() over (order by ts_rank_cd(f.fts, q.query) desc) as rnk
    from filtered f,
         lateral (
           select to_tsquery('simple',
                    array_to_string(tsvector_to_array(to_tsvector('english', query_text)), ' | ')
                  ) as query
         ) q
    where f.fts @@ q.query
    order by ts_rank_cd(f.fts, q.query) desc
    limit candidate_pool
  ),
  -- 4) RRF: score = Σ 1 / (k + rank). Rank-based, so no score normalisation needed.
  fused as (
    select coalesce(s.id, k.id) as id,
           coalesce(1.0 / (rrf_k + s.rnk), 0) + coalesce(1.0 / (rrf_k + k.rnk), 0) as score
    from semantic s
    full outer join keyword k on k.id = s.id
  )
  select f.id, f.document_id, f.title, f.content, f.context, f.metadata, fused.score::float
  from fused
  join filtered f on f.id = fused.id
  order by fused.score desc
  limit match_count;
$$;

-- Nearest cached answer above a similarity threshold and younger than the TTL
create or replace function match_cache(
  query_embedding       vector(1536),
  similarity_threshold  float default 0.95,
  ttl_hours             int   default 24
)
returns table (id uuid, answer text, sources jsonb, similarity float)
language sql stable
as $$
  select id, answer, sources, (1 - (embedding <=> query_embedding))::float as similarity
  from semantic_cache
  where created_at > now() - make_interval(hours => ttl_hours)
    and 1 - (embedding <=> query_embedding) >= similarity_threshold
  order by embedding <=> query_embedding
  limit 1;
$$;

-- Reporting views (security_invoker: RLS still applies, so only the service role can read them)
create view llm_cost_per_conversation with (security_invoker = true) as
  select conversation_id,
         count(*)                      as calls,
         sum(prompt_tokens)            as prompt_tokens,
         sum(completion_tokens)        as completion_tokens,
         sum(cost_usd)                 as cost_usd
  from llm_usage
  where conversation_id is not null
  group by conversation_id;

create view llm_latency_by_purpose with (security_invoker = true) as
  select purpose,
         count(*)                                                        as calls,
         round(percentile_cont(0.5)  within group (order by latency_ms)) as p50_ms,
         round(percentile_cont(0.95) within group (order by latency_ms)) as p95_ms,
         sum(cost_usd)                                                   as cost_usd
  from llm_usage
  group by purpose;
