-- 0003: Row Level Security.
-- Customers only ever see their own rows. The backend talks to Supabase with the
-- customer's JWT (anon key), so these policies are what actually enforce isolation.

alter table conversations   enable row level security;
alter table messages        enable row level security;
alter table appointments    enable row level security;
alter table tickets         enable row level security;

-- Service-only tables: RLS on + NO policies = invisible to anon/authenticated roles.
-- (The service-role key bypasses RLS, which is how ingestion/usage logging work.)
alter table documents       enable row level security;
alter table chunks          enable row level security;
alter table llm_usage       enable row level security;
alter table semantic_cache  enable row level security;

create policy "own conversations" on conversations
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "own messages" on messages
  for all to authenticated
  using (exists (select 1 from conversations c
                 where c.id = messages.conversation_id and c.user_id = (select auth.uid())))
  with check (exists (select 1 from conversations c
                      where c.id = messages.conversation_id and c.user_id = (select auth.uid())));

create policy "own appointments (read only)" on appointments
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "own tickets (read)" on tickets
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "own tickets (create)" on tickets
  for insert to authenticated
  with check ((select auth.uid()) = user_id);
