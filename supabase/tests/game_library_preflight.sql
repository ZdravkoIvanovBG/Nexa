-- Read-only checks to run BEFORE the Game Library migration. Safe on production:
-- it is a single SELECT over system catalogs and creates or changes nothing.
-- One statement on purpose: the SQL Editor only shows the last result it gets.
--
-- Keep the row "existing schema fingerprint". game_library_verify.sql prints the
-- same fingerprint afterwards, which proves the migration left every existing
-- table, policy and trigger exactly as it found them.

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

checks as (
  select 1 as sort, 'postgres version' as item,
    current_setting('server_version') as found,
    case when current_setting('server_version_num')::int >= 120000
      then 'ok' else 'STOP: the migration needs PostgreSQL 12 or newer' end as verdict

  union all
  select 2, 'new tables must not exist yet',
    coalesce(string_agg(tablename, ', '), 'none'),
    case when count(*) = 0 then 'ok' else 'STOP: already exists' end
  from pg_tables
  where schemaname = 'public' and tablename in ('game_library', 'game_queue')

  union all
  select 3, 'new functions must not exist yet',
    coalesce(string_agg(proname, ', '), 'none'),
    case when count(*) = 0 then 'ok' else 'STOP: already exists' end
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and proname in ('game_library_merge', 'game_queue_merge')

  union all
  select 4, 'auth.uid() is available',
    coalesce(string_agg(p.proname, ', '), 'missing'),
    case when count(*) = 1 then 'ok' else 'STOP: not a Supabase auth schema' end
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'auth' and p.proname = 'uid'

  union all
  select 5, 'roles authenticated and anon exist',
    coalesce(string_agg(rolname, ', ' order by rolname), 'missing'),
    case when count(*) = 2 then 'ok' else 'STOP: roles missing' end
  from pg_roles
  where rolname in ('authenticated', 'anon')

  union all
  select 6, 'existing Nexa tables with RLS on',
    coalesce(string_agg(tablename || '=' || rowsecurity::text, ', ' order by tablename), 'none'),
    case when count(*) filter (where not rowsecurity) = 0
      then 'ok' else 'REVIEW: an existing table has RLS off (unrelated to this migration)' end
  from pg_tables
  where schemaname = 'public'
    and tablename in ('watchlist', 'currently_watching', 'tier_list', 'user_addons',
                      'profiles', 'user_settings')

  union all
  select 7, 'Supabase CLI migration history',
    case
      when to_regclass('supabase_migrations.schema_migrations') is null then 'no history table'
      when not has_table_privilege('supabase_migrations.schema_migrations', 'select')
        then 'exists, not readable'
      else trim(regexp_replace(
        query_to_xml(
          'select count(*) as rows, max(version) as latest
           from supabase_migrations.schema_migrations',
          false, true, ''
        )::text,
        '<[^>]+>', ' ', 'g'
      ))
    end,
    case when to_regclass('supabase_migrations.schema_migrations') is null
      then 'ok: nothing to keep in step'
      else 'REVIEW: this project has CLI history, see supabase/README.md' end

  union all
  select 8, 'existing schema fingerprint',
    md5(coalesce(string_agg(line, E'\n' order by line), '')),
    'keep this: game_library_verify.sql must print the same value'
  from existing_schema

  -- How the existing tables scope rows, to compare with the new policies.
  union all
  select 9, 'policy on ' || tablename || ': ' || policyname,
    cmd || ' using ' || coalesce(qual, '(none)') || ' check ' || coalesce(with_check, '(none)'),
    'for comparison'
  from pg_policies
  where schemaname = 'public'
    and tablename in ('watchlist', 'currently_watching', 'tier_list', 'user_addons',
                      'profiles', 'user_settings')
)
select item, found, verdict from checks order by sort, item;
