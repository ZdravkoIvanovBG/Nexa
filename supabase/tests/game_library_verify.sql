-- Read-only proof that the Game Library migration landed as written. Safe on
-- production: it is a single SELECT over system catalogs, so it creates no users,
-- writes no rows and changes nothing.
--
-- It proves the definitions, not the behaviour. Behaviour is proven by running
-- game_library_checks.sql on a separate project: if the two projects print the
-- same "game library fingerprint", production has exactly what was tested there.

with existing_schema (line) as (
  select 'column ' || table_schema || '.' || table_name || '.' || column_name || ' '
    || udt_name || ' ' || is_nullable || ' ' || coalesce(column_default, '')
  from information_schema.columns
  where (table_schema = 'public' and table_name not in ('game_library', 'game_queue'))
    or (table_schema = 'auth' and table_name = 'users')
  union all
  select 'constraint ' || c.relname || ' ' || con.conname || ' ' || pg_get_constraintdef(con.oid)
  from pg_constraint con
  join pg_class c on c.oid = con.conrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname not in ('game_library', 'game_queue')
  union all
  select 'trigger ' || c.relname || ' ' || pg_get_triggerdef(t.oid)
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
  where not t.tgisinternal
    and ((n.nspname = 'public' and c.relname not in ('game_library', 'game_queue'))
      or (n.nspname = 'auth' and c.relname = 'users'))
  union all
  select 'policy ' || tablename || ' ' || policyname || ' ' || cmd || ' '
    || coalesce(qual, '') || ' ' || coalesce(with_check, '')
  from pg_policies
  where schemaname = 'public' and tablename not in ('game_library', 'game_queue')
  union all
  select 'rls ' || tablename || ' ' || rowsecurity::text
  from pg_tables
  where schemaname = 'public' and tablename not in ('game_library', 'game_queue')
),

game_tables (rel) as (
  select c.oid
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname in ('game_library', 'game_queue')
),

game_functions (proc, name, source, definer, config, access) as (
  select p.oid, p.proname, p.prosrc, p.prosecdef, p.proconfig, coalesce(p.proacl::text, '')
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in ('game_library_merge', 'game_queue_merge')
),

game_columns (table_name, list) as (
  select table_name, string_agg(
    column_name || ' ' || udt_name || case when is_nullable = 'NO' then ' not null' else '' end,
    ', ' order by ordinal_position
  )
  from information_schema.columns
  where table_schema = 'public' and table_name in ('game_library', 'game_queue')
  group by table_name
),

game_constraints (kind, definition) as (
  select con.contype, pg_get_constraintdef(con.oid)
  from pg_constraint con
  join game_tables t on t.rel = con.conrelid
),

game_policies as (
  select * from pg_policies
  where schemaname = 'public' and tablename in ('game_library', 'game_queue')
),

game_triggers (name, definition, enabled) as (
  select t.tgname, pg_get_triggerdef(t.oid), t.tgenabled
  from pg_trigger t
  join game_tables g on g.rel = t.tgrelid
  where not t.tgisinternal
),

game_schema (line) as (
  select 'column ' || table_name || ' ' || list from game_columns
  union all select 'constraint ' || definition from game_constraints
  union all select 'trigger ' || enabled::text || ' ' || definition from game_triggers
  union all select 'function ' || access || ' ' || pg_get_functiondef(proc) from game_functions
  union all
  select 'rls ' || c.relname || ' ' || c.relrowsecurity::text
  from game_tables t
  join pg_class c on c.oid = t.rel
  union all
  select 'policy ' || tablename || ' ' || policyname || ' ' || cmd || ' ' || roles::text || ' '
    || coalesce(qual, '') || ' ' || coalesce(with_check, '')
  from game_policies
  union all
  select 'grant ' || table_name || ' ' || grantee || ' ' || privilege_type
  from information_schema.role_table_grants
  where table_schema = 'public' and table_name in ('game_library', 'game_queue')
    and grantee in ('anon', 'authenticated', 'PUBLIC')
),

checks as (
  select 1 as sort, 'both tables exist' as item,
    count(*)::text || ' of 2' as found,
    case when count(*) = 2 then 'ok' else 'STOP' end as verdict
  from game_tables

  union all
  select 2, 'game_library columns',
    coalesce((select list from game_columns where table_name = 'game_library'), 'missing'),
    case when (select list from game_columns where table_name = 'game_library') =
      'user_id uuid not null, profile_id text not null, game_id text not null, '
      'slug text not null, name text not null, released text, image text, '
      'meta_at int8 not null, status text, started_at int8, completed_at int8, '
      'state_at int8 not null, progress_enabled bool not null, progress int2, '
      'progress_at int8 not null, notes text not null, notes_at int8 not null, tier text, '
      'tier_position text, tier_at int8 not null, created_at int8 not null'
      then 'ok' else 'STOP: columns differ from the migration' end

  union all
  select 3, 'game_queue columns',
    coalesce((select list from game_columns where table_name = 'game_queue'), 'missing'),
    case when (select list from game_columns where table_name = 'game_queue') =
      'user_id uuid not null, profile_id text not null, entry_id text not null, '
      'parent_id text not null, kind text not null, game_id text, franchise_id text, '
      'title text not null, image text, catalog_seen jsonb not null, position text not null, '
      'added_at int8 not null, updated_at int8 not null, deleted_at int8, '
      'live_at int8 not null'
      then 'ok' else 'STOP: columns differ from the migration' end

  union all
  select 4, 'primary keys include user_id and profile_id',
    count(*)::text || ' of 2',
    case when count(*) = 2 then 'ok' else 'STOP' end
  from game_constraints
  where kind = 'p' and definition like 'PRIMARY KEY (user_id, profile_id, %'

  union all
  select 5, 'rows belong to auth.users and go with the account',
    count(*)::text || ' of 2',
    case when count(*) = 2 then 'ok' else 'STOP' end
  from game_constraints
  where kind = 'f' and definition like '%REFERENCES auth.users(id) ON DELETE CASCADE%'

  union all
  select 6, 'value checks on status, progress, tier and kind',
    count(*)::text || ' of 4',
    case when count(*) = 4 then 'ok' else 'STOP' end
  from game_constraints
  where kind = 'c'

  union all
  select 7, 'row level security is on for both tables',
    count(*)::text || ' of 2',
    case when count(*) = 2 then 'ok' else 'STOP: a table is unprotected' end
  from game_tables t
  join pg_class c on c.oid = t.rel
  where c.relrowsecurity

  union all
  select 8, 'four policies per table',
    count(*)::text || ' of 8',
    case when count(*) = 8 then 'ok' else 'STOP' end
  from game_policies
  where cmd in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')

  union all
  select 9, 'every policy is for signed-in users and tied to auth.uid() = user_id',
    count(*)::text || ' of 8',
    case when count(*) = 8 then 'ok' else 'STOP: a policy is wider than the migration' end
  from game_policies
  where roles = '{authenticated}'
    and permissive = 'PERMISSIVE'
    and (qual is null or (qual like '%auth.uid()%' and qual like '%user_id%'))
    and (with_check is null or (with_check like '%auth.uid()%' and with_check like '%user_id%'))
    and (cmd = 'INSERT' or qual is not null)
    and (cmd not in ('INSERT', 'UPDATE') or with_check is not null)

  union all
  select 10, 'both merge triggers run before every update',
    count(*)::text || ' of 2',
    case when count(*) = 2 then 'ok' else 'STOP: older writes would overwrite newer ones' end
  from game_triggers
  where enabled = 'O' and definition like '%BEFORE UPDATE ON%FOR EACH ROW%'

  union all
  select 11, 'the merge functions cover every field group',
    (select count(*) from game_functions where
      (name = 'game_library_merge'
        and source like '%new.meta_at < old.meta_at%'
        and source like '%new.state_at < old.state_at%'
        and source like '%new.progress_at < old.progress_at%'
        and source like '%new.notes_at < old.notes_at%'
        and source like '%new.tier_at < old.tier_at%')
      or (name = 'game_queue_merge'
        and source like '%new.updated_at < old.updated_at%'
        and source like '%new.live_at < old.live_at%'))::text || ' of 2',
    case when (select count(*) from game_functions where
      (name = 'game_library_merge'
        and source like '%new.meta_at < old.meta_at%'
        and source like '%new.state_at < old.state_at%'
        and source like '%new.progress_at < old.progress_at%'
        and source like '%new.notes_at < old.notes_at%'
        and source like '%new.tier_at < old.tier_at%')
      or (name = 'game_queue_merge'
        and source like '%new.updated_at < old.updated_at%'
        and source like '%new.live_at < old.live_at%')) = 2
      then 'ok' else 'STOP' end

  union all
  select 12, 'the merge functions run as the caller with a fixed search_path',
    count(*)::text || ' of 2',
    case when count(*) = 2 then 'ok' else 'STOP' end
  from game_functions
  where not definer and 'search_path=""' = any (config)

  union all
  select 13, 'nobody can call the merge functions directly',
    count(*)::text || ' of 2 locked',
    case when count(*) = 2 then 'ok' else 'STOP' end
  from game_functions
  where not has_function_privilege('anon', proc, 'execute')
    and not has_function_privilege('authenticated', proc, 'execute')

  union all
  select 14, 'anon has no access to either table',
    count(*)::text || ' of 2 locked',
    case when count(*) = 2 then 'ok' else 'STOP: anon can reach game data' end
  from game_tables
  where not has_table_privilege('anon', rel, 'select,insert,update,delete')

  union all
  select 15, 'signed-in users can use both tables',
    count(*)::text || ' of 2',
    case when count(*) = 2 then 'ok' else 'STOP: the app could not sync' end
  from game_tables
  where has_table_privilege('authenticated', rel, 'select')
    and has_table_privilege('authenticated', rel, 'insert')
    and has_table_privilege('authenticated', rel, 'update')
    and has_table_privilege('authenticated', rel, 'delete')

  union all
  select 16, 'game library fingerprint',
    md5(coalesce(string_agg(line, E'\n' order by line), '')),
    'compare: must match the project where the checks passed'
  from game_schema

  union all
  select 17, 'existing schema fingerprint',
    md5(coalesce(string_agg(line, E'\n' order by line), '')),
    'compare: must match the pre-flight value'
  from existing_schema
)
select item, found, verdict from (
  select 0 as sort, 'TOTAL' as item,
    count(*) filter (where verdict = 'ok')::text || ' ok, '
      || count(*) filter (where verdict like 'STOP%')::text || ' STOP' as found,
    case when count(*) filter (where verdict like 'STOP%') = 0
      then 'migration matches' else 'STOP: see the rows below' end as verdict
  from checks
  union all
  select sort, item, found, verdict from checks
) as results
order by sort, item;
