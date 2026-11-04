begin;

create table public.als_workspace (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  revision uuid not null,
  records jsonb not null check (
    jsonb_typeof(records) = 'object' and
    records ?& array['clientes', 'produtos', 'servicos', 'despesas'] and
    jsonb_typeof(records->'clientes') = 'array' and
    jsonb_typeof(records->'produtos') = 'array' and
    jsonb_typeof(records->'servicos') = 'array' and
    jsonb_typeof(records->'despesas') = 'array'
  )
);

alter table public.als_workspace enable row level security;
revoke all on public.als_workspace from public, anon, authenticated;
grant select, insert, update on public.als_workspace to authenticated;

create policy "Conta ALS acessa seus próprios registros"
  on public.als_workspace to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

commit;
