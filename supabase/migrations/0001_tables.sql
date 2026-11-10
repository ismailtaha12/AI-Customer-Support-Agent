-- 0001: extensions + tables
create extension if not exists vector;

-- ───────────── Knowledge base ─────────────
create table documents (
  id            uuid primary key default gen_random_uuid(),
  slug          text unique not null,            -- stable id, e.g. file name
  title         text not null,
  content_hash  text not null,                   -- skip re-ingesting unchanged docs
  metadata      jsonb not null default '{}',     -- { category, version }
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table chunks (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid not null references documents(id) on delete cascade,
  chunk_index  int  not null,
  content      text not null,                    -- the raw chunk (what the LLM sees)
  context      text not null default '',         -- LLM-written blurb (contextual retrieval)
  embedding    vector(1536) not null,            -- embedding of context + content
  -- keyword side of hybrid search: generated, so it can never drift from the text
  fts          tsvector generated always as
                 (to_tsvector('english', coalesce(context, '') || ' ' || content)) stored,
  metadata     jsonb not null default '{}',      -- copied from the document for filtering
  unique (document_id, chunk_index)
);

create index chunks_embedding_idx on chunks using hnsw (embedding vector_cosine_ops);
create index chunks_fts_idx       on chunks using gin (fts);
create index chunks_metadata_idx  on chunks using gin (metadata jsonb_path_ops);

-- ───────────── Conversations ─────────────
create table conversations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text,
  created_at  timestamptz not null default now()
);

create table messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references conversations(id) on delete cascade,
  role             text not null check (role in ('user', 'assistant')),
  content          text not null,
  metadata         jsonb not null default '{}',  -- intent, citations, tool calls, flags
  created_at       timestamptz not null default now()
);
create index messages_conv_idx on messages (conversation_id, created_at);

-- ───────────── Mock business data the agent can look up ─────────────
create table appointments (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  doctor     text not null,
  starts_at  timestamptz not null,
  status     text not null default 'confirmed' check (status in ('confirmed', 'cancelled', 'completed'))
);

create table tickets (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  conversation_id  uuid references conversations(id) on delete set null,
  subject          text not null,
  description      text not null,
  priority         text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  status           text not null default 'open' check (status in ('open', 'closed')),
  created_at       timestamptz not null default now()
);

-- ───────────── Production AI tables ─────────────
-- One row per LLM / embedding call: powers cost + latency reporting.
create table llm_usage (
  id                 bigint generated always as identity primary key,
  created_at         timestamptz not null default now(),
  conversation_id    uuid,
  purpose            text not null,              -- classify, generate, embed, ...
  model              text not null,
  prompt_tokens      int  not null default 0,
  completion_tokens  int  not null default 0,
  cost_usd           numeric(12, 6) not null default 0,
  latency_ms         int  not null default 0
);
create index llm_usage_conv_idx on llm_usage (conversation_id);

-- Semantic cache: answers to FAQ questions, reused for near-identical questions.
create table semantic_cache (
  id          uuid primary key default gen_random_uuid(),
  question    text not null,
  embedding   vector(1536) not null,
  answer      text not null,
  sources     jsonb not null default '[]',
  created_at  timestamptz not null default now()
);
create index semantic_cache_embedding_idx on semantic_cache using hnsw (embedding vector_cosine_ops);
