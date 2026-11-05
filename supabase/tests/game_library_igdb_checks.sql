-- IGDB Stage 6: proves the existing Game Library schema stores IGDB games next
-- to RAWG ones with no schema change. Run it on a BLANK TEST PROJECT that has
-- the 20261102120000_game_library migration. The result is one table: the total
-- first, then any FAIL rows, then the passes.
--
-- NOT FOR PRODUCTION. It needs two throwaway rows in auth.users, because the game
-- tables require a real user. It refuses to run if any account already exists.
-- Use game_library_verify.sql on production: it only reads.
--
-- It changes no schema and leaves nothing behind. All of its work happens inside
-- a block that always aborts itself at the end, and only the results survive
-- that. A temporary function disappears when the session ends.

create or replace function pg_temp.game_library_igdb_checks()
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

  names text[] := '{}';
  passed boolean[] := '{}';
  stored jsonb;
  before jsonb;
  denied boolean;
  affected int;
begin
  if exists (select 1 from auth.users) then
    raise exception 'game_library_igdb_checks.sql is for a blank test project, and this one has accounts.'
      using hint = 'Nothing was changed. On production, run game_library_verify.sql instead.';
  end if;

  begin
    insert into auth.users (id, aud, role, email) values
      (alice, 'authenticated', 'authenticated', 'game-library-igdb-a@example.invalid'),
      (bob, 'authenticated', 'authenticated', 'game-library-igdb-b@example.invalid');

    perform set_config('request.jwt.claims', alice_claims, true);
    set local role authenticated;

    -- ── identities ──────────────────────────────────────────────────────────
    -- What the app writes for a RAWG game and an IGDB game with the same number,
    -- an IGDB collection, and a collection holding members from both providers.
    insert into public.game_library (user_id, profile_id, game_id, slug, name, image, meta_at)
    values
      (alice, 'p1', 'rawg:1942', 'the-witcher-3-wild-hunt', 'The Witcher 3 (RAWG)',
        'https://media.rawg.io/media/games/618/x.jpg', 100),
      (alice, 'p1', 'igdb:1942', 'the-witcher-3-wild-hunt', 'The Witcher 3 (IGDB)',
        'https://images.igdb.com/igdb/image/upload/t_cover_big/co1wyy.jpg', 100),
      (alice, 'p1', 'igdb:128', 'assassins-creed', 'Assassin''s Creed', null, 100),
      (alice, 'p1', 'rawg:3', 'assassins-creed-ii', 'Assassin''s Creed II', null, 100);
    insert into public.game_queue
      (user_id, profile_id, entry_id, parent_id, kind, game_id, franchise_id, title,
        catalog_seen, position, added_at, updated_at, live_at)
    values
      (alice, 'p1', 'g:rawg:1942', '', 'game', 'rawg:1942', null, '', '[]', 'U1', 100, 100, 100),
      (alice, 'p1', 'g:igdb:1942', '', 'game', 'igdb:1942', null, '', '[]', 'U2', 100, 100, 100),
      (alice, 'p1', 'c:assassins-creed', '', 'collection', null, 'assassins-creed',
        'Assassin''s Creed', '["assassins-creed","assassins-creed-ii"]', 'U3', 100, 100, 100),
      (alice, 'p1', 'c:assassins-creed|igdb:128', 'c:assassins-creed', 'game', 'igdb:128',
        null, '', '[]', 'V1', 100, 100, 100),
      (alice, 'p1', 'c:assassins-creed|rawg:3', 'c:assassins-creed', 'game', 'rawg:3',
        null, '', '[]', 'V2', 100, 100, 100);

    names := names || 'rawg:N and igdb:N are separate rows'::text;
    passed := passed || (
      (select count(*) from public.game_library where game_id in ('rawg:1942', 'igdb:1942')) = 2
      and (select count(*) from public.game_queue where entry_id in ('g:rawg:1942', 'g:igdb:1942')) = 2
    );

    names := names || 'a collection holds members from both providers'::text;
    passed := passed || (
      select count(*) = 2 from public.game_queue
      where parent_id = 'c:assassins-creed' and game_id in ('igdb:128', 'rawg:3')
    );

    insert into public.game_library (user_id, profile_id, game_id, name)
    values (alice, 'p1', 'igdb:9007199254740991', 'Largest id the client accepts');
    names := names || 'the largest IGDB id the client accepts fits'::text;
    passed := passed || exists (
      select 1 from public.game_library where game_id = 'igdb:9007199254740991'
    );

    -- ── row level security ──────────────────────────────────────────────────
    denied := false;
    begin
      insert into public.game_library (user_id, profile_id, game_id) values (bob, 'p1', 'igdb:1');
    exception when insufficient_privilege then denied := true;
    end;
    names := names || 'a user cannot insert an IGDB row for another account'::text;
    passed := passed || denied;

    reset role;
    perform set_config('request.jwt.claims', bob_claims, true);
    set local role authenticated;

    names := names || 'another account sees none of the IGDB rows'::text;
    passed := passed || (
      (select count(*) from public.game_library where game_id like 'igdb:%') = 0
      and (select count(*) from public.game_queue where entry_id like '%igdb:%') = 0
    );

    update public.game_library set notes = 'hacked' where game_id = 'igdb:1942';
    get diagnostics affected = row_count;
    names := names || 'another account cannot update an IGDB row'::text;
    passed := passed || (affected = 0);

    delete from public.game_queue where entry_id like '%igdb:%';
    get diagnostics affected = row_count;
    names := names || 'another account cannot delete IGDB queue rows'::text;
    passed := passed || (affected = 0);

    -- Bob saving the same IGDB game gets his own row.
    insert into public.game_library (user_id, profile_id, game_id, name)
    values (bob, 'p1', 'igdb:1942', 'Bob''s copy');
    reset role;
    names := names || 'the same IGDB game is a separate row per account'::text;
    passed := passed || (
      (select count(*) from public.game_library where game_id = 'igdb:1942') = 2
      and (select name from public.game_library where user_id = alice and game_id = 'igdb:1942')
        = 'The Witcher 3 (IGDB)'
    );

    -- ── merge triggers, written the way PostgREST writes an upsert ───────────
    perform set_config('request.jwt.claims', alice_claims, true);
    set local role authenticated;

    -- An older snapshot (a stale device) can't replace a newer one, while a
    -- newer note in the same write still lands.
    insert into public.game_library (user_id, profile_id, game_id, slug, name, image, meta_at, notes, notes_at)
    values (alice, 'p1', 'igdb:1942', 'old', 'Old name', null, 50, 'new note', 200)
    on conflict (user_id, profile_id, game_id) do update set
      slug = excluded.slug, name = excluded.name, image = excluded.image,
      meta_at = excluded.meta_at, notes = excluded.notes, notes_at = excluded.notes_at;
    select to_jsonb(g) into stored from public.game_library g
    where user_id = alice and profile_id = 'p1' and game_id = 'igdb:1942';
    names := names || 'an IGDB row merges by field group like a RAWG row'::text;
    passed := passed || (
      stored ->> 'name' = 'The Witcher 3 (IGDB)'
      and stored ->> 'image' like 'https://images.igdb.com/%'
      and stored ->> 'notes' = 'new note'
    );

    -- A pre-IGDB build only ever writes rawg: rows. Its upserts must leave the
    -- IGDB rows with the same number, and the IGDB queue rows, exactly as they are.
    select jsonb_agg(to_jsonb(x) order by x.k) into before from (
      select 'l' || game_id as k, g.* from public.game_library g where game_id like 'igdb:%'
    ) x;
    insert into public.game_library (user_id, profile_id, game_id, slug, name, meta_at, notes, notes_at)
    values (alice, 'p1', 'rawg:1942', 'the-witcher-3-wild-hunt', 'Renamed by RAWG', 300, 'rawg note', 300)
    on conflict (user_id, profile_id, game_id) do update set
      slug = excluded.slug, name = excluded.name, meta_at = excluded.meta_at,
      notes = excluded.notes, notes_at = excluded.notes_at;
    insert into public.game_queue
      (user_id, profile_id, entry_id, parent_id, kind, game_id, title, catalog_seen, position,
        added_at, updated_at, deleted_at, live_at)
    values
      (alice, 'p1', 'c:assassins-creed', '', 'collection', null, 'Assassin''s Creed', '[]', 'T0', 100, 300, null, 100),
      (alice, 'p1', 'c:assassins-creed|rawg:3', 'c:assassins-creed', 'game', 'rawg:3', '', '[]', 'V0', 100, 300, 300, 300)
    on conflict (user_id, profile_id, entry_id) do update set
      parent_id = excluded.parent_id, kind = excluded.kind, game_id = excluded.game_id,
      title = excluded.title, catalog_seen = excluded.catalog_seen, position = excluded.position,
      added_at = excluded.added_at, updated_at = excluded.updated_at,
      deleted_at = excluded.deleted_at, live_at = excluded.live_at;
    names := names || 'RAWG-only upserts leave every IGDB row unchanged'::text;
    passed := passed || (
      before = (select jsonb_agg(to_jsonb(x) order by x.k) from (
        select 'l' || game_id as k, g.* from public.game_library g where game_id like 'igdb:%'
      ) x)
      and (select deleted_at is null and position = 'V1' from public.game_queue
        where user_id = alice and entry_id = 'c:assassins-creed|igdb:128')
      and (select position = 'U2' and deleted_at is null from public.game_queue
        where user_id = alice and entry_id = 'g:igdb:1942')
    );

    -- Removing an IGDB member is a tombstone; an older write can't revive it.
    update public.game_queue set deleted_at = 400, live_at = 400
    where user_id = alice and entry_id = 'c:assassins-creed|igdb:128';
    insert into public.game_queue
      (user_id, profile_id, entry_id, parent_id, kind, game_id, title, catalog_seen, position,
        added_at, updated_at, deleted_at, live_at)
    values (alice, 'p1', 'c:assassins-creed|igdb:128', 'c:assassins-creed', 'game', 'igdb:128',
      '', '[]', 'V9', 100, 500, null, 350)
    on conflict (user_id, profile_id, entry_id) do update set
      position = excluded.position, updated_at = excluded.updated_at,
      deleted_at = excluded.deleted_at, live_at = excluded.live_at;
    select to_jsonb(q) into stored from public.game_queue q
    where user_id = alice and entry_id = 'c:assassins-creed|igdb:128';
    names := names || 'a reorder from a stale device cannot revive a removed IGDB member'::text;
    passed := passed || (
      (stored ->> 'deleted_at')::bigint = 400 and stored ->> 'position' = 'V9'
    );

    -- ── profiles and accounts ───────────────────────────────────────────────
    insert into public.game_library (user_id, profile_id, game_id, name)
    values (alice, 'p2', 'igdb:1942', 'Other profile');
    names := names || 'profiles keep separate rows for the same IGDB game'::text;
    passed := passed || (
      (select count(*) from public.game_library where user_id = alice and game_id = 'igdb:1942') = 2
    );

    reset role;
    delete from auth.users where id = alice;
    names := names || 'deleting an account deletes its IGDB rows too'::text;
    passed := passed || (
      (select count(*) from public.game_library where user_id = alice) = 0
      and (select count(*) from public.game_queue where user_id = alice) = 0
      and (select count(*) from public.game_library where user_id = bob) = 1
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

select * from pg_temp.game_library_igdb_checks();
