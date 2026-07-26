-- EZ Cards optional Supabase persistence adapter
-- Run this migration in a dedicated Supabase project, then set
-- SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Netlify.
-- The application automatically switches from Netlify Blobs to this table.

create extension if not exists pgcrypto;

create table if not exists public.ezcards_kv (
  store text not null,
  key text not null,
  value jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (store, key),
  constraint ezcards_store_length check (char_length(store) between 1 and 120),
  constraint ezcards_key_length check (char_length(key) between 1 and 1000)
);

create index if not exists ezcards_kv_store_key_prefix_idx
  on public.ezcards_kv (store, key text_pattern_ops);

create index if not exists ezcards_kv_updated_at_idx
  on public.ezcards_kv (updated_at desc);

alter table public.ezcards_kv enable row level security;

-- Intentionally no anon/authenticated policies. All application access occurs
-- through the Netlify Functions service layer using the service-role key.
revoke all on table public.ezcards_kv from anon, authenticated;
grant all on table public.ezcards_kv to service_role;

comment on table public.ezcards_kv is
  'Server-only persistence for EZ Cards accounts, invitations, rules, signals, devices, jobs, billing state, and encrypted integration configuration.';
comment on column public.ezcards_kv.store is 'Logical namespace such as ezcards-auth-v1 or ezcards-signals-v1.';
comment on column public.ezcards_kv.key is 'Application-defined hierarchical key.';
comment on column public.ezcards_kv.value is 'Validated JSON document written only by the trusted server layer.';
