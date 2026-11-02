-- Verifies the Game Library migration: RLS, merge triggers and constraints.
-- Run it AFTER the migration. The result is one table of pass/FAIL rows.
--
-- It leaves nothing behind. All of its work, including two throwaway auth users,
-- happens inside a block that always aborts itself at the end, and only the
-- results survive that. A temporary function disappears when the session ends.

create function pg_temp.game_library_checks()
returns table (seq int, check_name text, outcome text)
language plpgsql
as $checks$
declare
  alice constant uuid := 'aaaaaaaa-0000-4000-8000-00000000000a';
  bob constant uuid := 'bbbbbbbb-0000-4000-8000-00000000000b';
  alice_claims constant text :=
    '{"sub":"aaaaaaaa-0000-4000-8000-00000000000a","role":"authenticated"}';
  bob_claims constant text :=
    '{"sub":"bbbbbbbb-0000-4000-8000-00000000000b","role":"authenticated"}';

  -- Same cases as tests/fixtures/game-merge-cases.json, with database column
  -- names. tests/game-library-sql.test.ts fails if the two ever drift apart.
  cases constant jsonb := $cases$
  {
    "records": [
      {
        "name": "a newer state group replaces an older one",
        "stored": { "status": "paused", "progress": 20, "state_at": 100 },
        "incoming": { "status": "playing", "progress": 35, "state_at": 200 },
        "expected": { "status": "playing", "progress": 35, "state_at": 200 }
      },
      {
        "name": "an older state group is ignored",
        "stored": { "status": "completed", "completed_at": 150, "state_at": 200 },
        "incoming": { "status": "playing", "completed_at": null, "state_at": 100 },
        "expected": { "status": "completed", "completed_at": 150, "state_at": 200 }
      },
      {
        "name": "a newer note survives alongside a newer stored status",
        "stored": { "status": "completed", "state_at": 300, "notes": "old", "notes_at": 100 },
        "incoming": {
          "status": "playing",
          "state_at": 100,
          "notes": "Exploring Rome.",
          "notes_at": 200
        },
        "expected": {
          "status": "completed",
          "state_at": 300,
          "notes": "Exploring Rome.",
          "notes_at": 200
        }
      },
      {
        "name": "a newer stored note survives a newer incoming status",
        "stored": { "status": "paused", "state_at": 100, "notes": "Sequence 4", "notes_at": 300 },
        "incoming": { "status": "playing", "state_at": 200, "notes": "", "notes_at": 100 },
        "expected": { "status": "playing", "state_at": 200, "notes": "Sequence 4", "notes_at": 300 }
      },
      {
        "name": "a status change on one device cannot overwrite a rank from another",
        "stored": {
          "tier": "S",
          "tier_position": "U1",
          "tier_at": 300,
          "status": "playing",
          "state_at": 100
        },
        "incoming": {
          "tier": null,
          "tier_position": null,
          "tier_at": 0,
          "status": "completed",
          "state_at": 200
        },
        "expected": {
          "tier": "S",
          "tier_position": "U1",
          "tier_at": 300,
          "status": "completed",
          "state_at": 200
        }
      },
      {
        "name": "removing a tile beats an older rank",
        "stored": { "tier": "A", "tier_position": "U1", "tier_at": 100 },
        "incoming": { "tier": "hidden", "tier_position": null, "tier_at": 200 },
        "expected": { "tier": "hidden", "tier_position": null, "tier_at": 200 }
      },
      {
        "name": "all three groups can come from different sides",
        "stored": {
          "status": "dropped",
          "state_at": 100,
          "notes": "kept",
          "notes_at": 300,
          "tier": "F",
          "tier_position": "a",
          "tier_at": 100
        },
        "incoming": {
          "status": "playing",
          "state_at": 200,
          "notes": "older",
          "notes_at": 200,
          "tier": "S",
          "tier_position": "b",
          "tier_at": 200
        },
        "expected": {
          "status": "playing",
          "state_at": 200,
          "notes": "kept",
          "notes_at": 300,
          "tier": "S",
          "tier_position": "b",
          "tier_at": 200
        }
      }
    ],
    "queue": [
      {
        "name": "a newer move replaces an older one",
        "stored": { "position": "U1", "updated_at": 100 },
        "incoming": { "position": "V1", "updated_at": 200 },
        "expected": { "position": "V1", "updated_at": 200 }
      },
      {
        "name": "an older move is skipped",
        "stored": { "position": "V1", "updated_at": 200 },
        "incoming": { "position": "U1", "updated_at": 100 },
        "expected": { "position": "V1", "updated_at": 200 }
      },
      {
        "name": "a newer tombstone removes the row",
        "stored": { "deleted_at": null, "updated_at": 100 },
        "incoming": { "deleted_at": 200, "updated_at": 200 },
        "expected": { "deleted_at": 200, "updated_at": 200 }
      },
      {
        "name": "an older edit cannot resurrect a tombstone",
        "stored": { "deleted_at": 200, "updated_at": 200 },
        "incoming": { "deleted_at": null, "updated_at": 100 },
        "expected": { "deleted_at": 200, "updated_at": 200 }
      },
      {
        "name": "undo beats the tombstone it restores",
        "stored": { "deleted_at": 200, "updated_at": 200 },
        "incoming": { "deleted_at": null, "updated_at": 201 },
        "expected": { "deleted_at": null, "updated_at": 201 }
      }
    ]
  }
  $cases$::jsonb;

  names text[] := '{}';
  passed boolean[] := '{}';
  merge_case jsonb;
  base jsonb;
  stored jsonb;
  denied boolean;
  affected int;
  i int;
begin
  begin
    -- ── structure ───────────────────────────────────────────────────────────
    names := names || 'RLS is enabled on both tables'::text;
    passed := passed || (
      select count(*) = 2 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname in ('game_library', 'game_queue')
        and c.relrowsecurity
    );

    names := names || 'each table has select, insert, update and delete policies'::text;
    passed := passed || (
      select count(*) = 8 from pg_policies
      where schemaname = 'public' and tablename in ('game_library', 'game_queue')
    );

    names := names || 'both merge triggers are installed and enabled'::text;
    passed := passed || (
      select count(*) = 2 from pg_trigger
      where tgname in ('game_library_merge', 'game_queue_keep_newest')
        and tgenabled = 'O'
    );

    names := names || 'anon has no access to either table'::text;
    passed := passed || (
      not has_table_privilege('anon', 'public.game_library', 'select,insert,update,delete')
      and not has_table_privilege('anon', 'public.game_queue', 'select,insert,update,delete')
    );

    names := names || 'the trigger functions cannot be called by users'::text;
    passed := passed || (
      not has_function_privilege('authenticated', 'public.game_library_merge()', 'execute')
      and not has_function_privilege('authenticated', 'public.game_queue_keep_newest()', 'execute')
      and not has_function_privilege('anon', 'public.game_library_merge()', 'execute')
    );

    -- ── row level security ──────────────────────────────────────────────────
    insert into auth.users (id, aud, role, email) values
      (alice, 'authenticated', 'authenticated', 'game-library-check-a@example.invalid'),
      (bob, 'authenticated', 'authenticated', 'game-library-check-b@example.invalid');

    perform set_config('request.jwt.claims', alice_claims, true);
    set local role authenticated;

    insert into public.game_library (user_id, profile_id, game_id, name, notes)
    values (alice, 'p1', 'rawg:1', 'Alice game', 'private note');
    insert into public.game_queue (user_id, profile_id, entry_id, kind, game_id, position)
    values (alice, 'p1', 'g:rawg:1', 'game', 'rawg:1', 'U1');

    names := names || 'a user can write and read their own rows'::text;
    passed := passed || (
      (select count(*) from public.game_library) = 1
      and (select count(*) from public.game_queue) = 1
    );

    denied := false;
    begin
      insert into public.game_library (user_id, profile_id, game_id) values (bob, 'p1', 'rawg:2');
    exception when insufficient_privilege then denied := true;
    end;
    names := names || 'a user cannot insert a row for another account'::text;
    passed := passed || denied;

    denied := false;
    begin
      insert into public.game_queue (user_id, profile_id, entry_id, kind, position)
      values (bob, 'p1', 'g:rawg:2', 'game', 'U1');
    exception when insufficient_privilege then denied := true;
    end;
    names := names || 'a user cannot insert a queue row for another account'::text;
    passed := passed || denied;

    denied := false;
    begin
      update public.game_library set user_id = bob where game_id = 'rawg:1';
    exception when insufficient_privilege then denied := true;
    end;
    names := names || 'a user cannot hand a row to another account'::text;
    passed := passed || denied;

    reset role;
    perform set_config('request.jwt.claims', bob_claims, true);
    set local role authenticated;

    names := names || 'another account sees none of those rows'::text;
    passed := passed || (
      (select count(*) from public.game_library) = 0
      and (select count(*) from public.game_queue) = 0
    );

    update public.game_library set notes = 'hacked' where user_id = alice;
    get diagnostics affected = row_count;
    names := names || 'another account cannot update those rows'::text;
    passed := passed || (affected = 0);

    delete from public.game_library where user_id = alice;
    get diagnostics affected = row_count;
    names := names || 'another account cannot delete those rows'::text;
    passed := passed || (affected = 0);

    delete from public.game_queue where user_id = alice;
    get diagnostics affected = row_count;
    names := names || 'another account cannot delete queue rows'::text;
    passed := passed || (affected = 0);

    reset role;
    names := names || 'the other account''s attempts changed nothing'::text;
    passed := passed || (
      (select notes from public.game_library where user_id = alice) = 'private note'
      and (select count(*) from public.game_queue where user_id = alice) = 1
    );

    perform set_config('request.jwt.claims', '', true);
    denied := false;
    begin
      set local role anon;
      perform count(*) from public.game_library;
    exception when insufficient_privilege then denied := true;
    end;
    reset role;
    names := names || 'anon cannot read the tables'::text;
    passed := passed || denied;

    -- One account may hold several profiles. RLS can't separate those, so
    -- this records what the app must do: always filter on profile_id.
    perform set_config('request.jwt.claims', alice_claims, true);
    set local role authenticated;
    insert into public.game_library (user_id, profile_id, game_id, name)
    values (alice, 'p2', 'rawg:1', 'Same game, other profile');
    names := names || 'profiles keep separate rows for the same game'::text;
    passed := passed || (
      (select count(*) from public.game_library where profile_id = 'p1') = 1
      and (select count(*) from public.game_library where profile_id = 'p2') = 1
    );

    -- ── merge rules, written the way PostgREST writes an upsert ─────────────
    i := 0;
    for merge_case in select value from jsonb_array_elements(cases -> 'records') loop
      i := i + 1;
      base := jsonb_build_object(
        'user_id', alice, 'profile_id', 'merge-cases', 'game_id', 'rawg:' || i,
        'slug', '', 'name', 'Check', 'progress_enabled', false, 'state_at', 0,
        'notes', '', 'notes_at', 0, 'tier_at', 0, 'created_at', 0
      );
      insert into public.game_library
      select * from jsonb_populate_record(null::public.game_library, base || (merge_case -> 'stored'));
      insert into public.game_library
      select * from jsonb_populate_record(null::public.game_library, base || (merge_case -> 'incoming'))
      on conflict (user_id, profile_id, game_id) do update set
        slug = excluded.slug, name = excluded.name, released = excluded.released,
        image = excluded.image, status = excluded.status, started_at = excluded.started_at,
        completed_at = excluded.completed_at, progress_enabled = excluded.progress_enabled,
        progress = excluded.progress, state_at = excluded.state_at, notes = excluded.notes,
        notes_at = excluded.notes_at, tier = excluded.tier,
        tier_position = excluded.tier_position, tier_at = excluded.tier_at,
        created_at = excluded.created_at;
      select to_jsonb(g) into stored from public.game_library g
      where g.profile_id = 'merge-cases' and g.game_id = 'rawg:' || i;
      names := names || ('record: ' || (merge_case ->> 'name'));
      passed := passed || (stored @> (merge_case -> 'expected'));
    end loop;

    i := 0;
    for merge_case in select value from jsonb_array_elements(cases -> 'queue') loop
      i := i + 1;
      base := jsonb_build_object(
        'user_id', alice, 'profile_id', 'merge-cases', 'entry_id', 'entry-' || i,
        'parent_id', '', 'kind', 'game', 'game_id', 'rawg:1', 'title', '',
        'catalog_seen', '[]'::jsonb, 'position', 'U1', 'added_at', 0, 'updated_at', 0
      );
      insert into public.game_queue
      select * from jsonb_populate_record(null::public.game_queue, base || (merge_case -> 'stored'));
      insert into public.game_queue
      select * from jsonb_populate_record(null::public.game_queue, base || (merge_case -> 'incoming'))
      on conflict (user_id, profile_id, entry_id) do update set
        parent_id = excluded.parent_id, kind = excluded.kind, game_id = excluded.game_id,
        franchise_id = excluded.franchise_id, title = excluded.title, image = excluded.image,
        catalog_seen = excluded.catalog_seen, position = excluded.position,
        added_at = excluded.added_at, updated_at = excluded.updated_at,
        deleted_at = excluded.deleted_at;
      select to_jsonb(q) into stored from public.game_queue q
      where q.profile_id = 'merge-cases' and q.entry_id = 'entry-' || i;
      names := names || ('queue: ' || (merge_case ->> 'name'));
      passed := passed || (stored @> (merge_case -> 'expected'));
    end loop;

    -- ── constraints ─────────────────────────────────────────────────────────
    denied := false;
    begin
      insert into public.game_library (user_id, profile_id, game_id, status)
      values (alice, 'p1', 'rawg:50', 'not-a-status');
    exception when check_violation then denied := true;
    end;
    names := names || 'an unknown status is rejected'::text;
    passed := passed || denied;

    denied := false;
    begin
      insert into public.game_library (user_id, profile_id, game_id, progress)
      values (alice, 'p1', 'rawg:51', 101);
    exception when check_violation then denied := true;
    end;
    names := names || 'progress above 100 is rejected'::text;
    passed := passed || denied;

    denied := false;
    begin
      insert into public.game_library (user_id, profile_id, game_id, tier)
      values (alice, 'p1', 'rawg:52', 'Z');
    exception when check_violation then denied := true;
    end;
    names := names || 'an unknown tier is rejected'::text;
    passed := passed || denied;

    denied := false;
    begin
      insert into public.game_queue (user_id, profile_id, entry_id, kind, position)
      values (alice, 'p1', 'x', 'movie', 'U1');
    exception when check_violation then denied := true;
    end;
    names := names || 'a movie cannot be stored in the game queue'::text;
    passed := passed || denied;

    -- ── account deletion ────────────────────────────────────────────────────
    reset role;
    delete from auth.users where id = alice;
    names := names || 'deleting an account deletes its game data'::text;
    passed := passed || (
      (select count(*) from public.game_library where user_id = alice) = 0
      and (select count(*) from public.game_queue where user_id = alice) = 0
    );

    -- Undoes everything above. The results live in variables, so they survive.
    raise exception using errcode = 'GL000';
  exception when sqlstate 'GL000' then
    null;
  end;

  return query
    select 0, 'TOTAL'::text,
      format('%s passed, %s failed',
        (select count(*) from unnest(passed) p where p),
        (select count(*) from unnest(passed) p where p is distinct from true));
  return query
    select r.ord::int, r.check_name, case when r.ok then 'pass' else 'FAIL' end
    from unnest(names, passed) with ordinality as r(check_name, ok, ord)
    order by (r.ok is true), r.ord;
end;
$checks$;

select * from pg_temp.game_library_checks() order by seq = 0 desc;
