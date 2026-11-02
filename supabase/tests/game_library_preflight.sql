-- Read-only checks to run BEFORE the Game Library migration. Changes nothing.
-- One statement on purpose: the SQL Editor only shows the last result it gets.

with checks as (
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
    and proname in ('game_library_merge', 'game_queue_keep_newest')

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

  -- How the existing tables scope rows, to compare with the new policies.
  union all
  select 7, 'policy on ' || tablename || ': ' || policyname,
    cmd || ' using ' || coalesce(qual, '(none)') || ' check ' || coalesce(with_check, '(none)'),
    'for comparison'
  from pg_policies
  where schemaname = 'public'
    and tablename in ('watchlist', 'currently_watching', 'tier_list', 'user_addons',
                      'profiles', 'user_settings')
)
select item, found, verdict from checks order by sort, item;
