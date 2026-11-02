-- Nexa Game Library: personal game records and the Wishlist play queue.
--
-- Purely additive. It creates two new tables, two trigger functions, two
-- triggers and eight RLS policies. It does not read, alter or reference any
-- existing Nexa table except auth.users, which it only references by foreign key.
--
-- All-or-nothing: if any statement fails, the whole script rolls back.
-- Running it a second time fails on the first statement and changes nothing.
-- To undo it, see supabase/rollback/20261102120000_game_library_down.sql.

begin;

-- One row per game per profile: the single personal record for that game. Its
-- fields form groups, each with its own stamp (epoch milliseconds), so devices
-- can change different things without overwriting each other. A stamp of 0 means
-- "never changed here", so a brand new record can't overwrite an existing one.
create table public.game_library (
  user_id uuid not null references auth.users (id) on delete cascade,
  profile_id text not null,
  game_id text not null,

  -- Snapshot, so the library renders with RAWG unreachable.
  slug text not null default '',
  name text not null default '',
  released text,
  image text,
  meta_at bigint not null default 0,

  -- State group.
  status text check (status in ('playing', 'paused', 'completed', 'dropped')),
  started_at bigint,
  completed_at bigint,
  state_at bigint not null default 0,

  -- Progress group.
  progress_enabled boolean not null default false,
  progress smallint check (progress between 0 and 100),
  progress_at bigint not null default 0,

  -- Notes group.
  notes text not null default '',
  notes_at bigint not null default 0,

  -- Tier group.
  tier text check (tier in ('S', 'A', 'B', 'C', 'D', 'F', 'unranked', 'hidden')),
  tier_position text,
  tier_at bigint not null default 0,

  created_at bigint not null default 0,

  primary key (user_id, profile_id, game_id)
);

-- One row per Wishlist entry or collection member. parent_id is '' for a root
-- entry, or the owning collection's entry_id. Deleted rows are kept with
-- deleted_at set, so other devices learn about the deletion. Where a row sits
-- (updated_at) and whether it exists (live_at) have separate stamps, so a
-- reorder on one device can't undo a removal made on another.
create table public.game_queue (
  user_id uuid not null references auth.users (id) on delete cascade,
  profile_id text not null,
  entry_id text not null,

  parent_id text not null default '',
  kind text not null check (kind in ('game', 'collection')),
  game_id text,
  franchise_id text,
  title text not null default '',
  image text,
  catalog_seen jsonb not null default '[]'::jsonb,
  position text not null,

  added_at bigint not null default 0,
  updated_at bigint not null default 0,

  deleted_at bigint,
  live_at bigint not null default 0,

  primary key (user_id, profile_id, entry_id)
);

-- Keeps the newer version of each field group, whatever order writes arrive in.
-- A device with stale state and a new note can't overwrite a status changed
-- elsewhere, even if it never pulled first. Must match mergeRecord in
-- src/lib/game-library/merge.ts.
create function public.game_library_merge()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.meta_at < old.meta_at then
    new.slug := old.slug;
    new.name := old.name;
    new.released := old.released;
    new.image := old.image;
    new.meta_at := old.meta_at;
  end if;

  if new.state_at < old.state_at then
    new.status := old.status;
    new.started_at := old.started_at;
    new.completed_at := old.completed_at;
    new.state_at := old.state_at;
  end if;

  if new.progress_at < old.progress_at then
    new.progress_enabled := old.progress_enabled;
    new.progress := old.progress;
    new.progress_at := old.progress_at;
  end if;

  if new.notes_at < old.notes_at then
    new.notes := old.notes;
    new.notes_at := old.notes_at;
  end if;

  if new.tier_at < old.tier_at then
    new.tier := old.tier;
    new.tier_position := old.tier_position;
    new.tier_at := old.tier_at;
  end if;

  return new;
end;
$$;

-- The same rule for queue rows. Must match mergeEntry in
-- src/lib/game-library/merge.ts.
create function public.game_queue_merge()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.updated_at < old.updated_at then
    new.parent_id := old.parent_id;
    new.kind := old.kind;
    new.game_id := old.game_id;
    new.franchise_id := old.franchise_id;
    new.title := old.title;
    new.image := old.image;
    new.catalog_seen := old.catalog_seen;
    new.position := old.position;
    new.added_at := old.added_at;
    new.updated_at := old.updated_at;
  end if;

  if new.live_at < old.live_at then
    new.deleted_at := old.deleted_at;
    new.live_at := old.live_at;
  end if;

  return new;
end;
$$;

-- Only triggers need these. Nothing should be able to call them directly.
revoke all on function public.game_library_merge() from public, anon, authenticated;
revoke all on function public.game_queue_merge() from public, anon, authenticated;

create trigger game_library_merge
  before update on public.game_library
  for each row execute function public.game_library_merge();

create trigger game_queue_merge
  before update on public.game_queue
  for each row execute function public.game_queue_merge();

alter table public.game_library enable row level security;
alter table public.game_queue enable row level security;

-- An account reaches only its own rows. All profiles on an account share one
-- auth user, so RLS can't separate profiles: the app does, through profile_id.
create policy "game_library_select_own" on public.game_library
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "game_library_insert_own" on public.game_library
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "game_library_update_own" on public.game_library
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "game_library_delete_own" on public.game_library
  for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy "game_queue_select_own" on public.game_queue
  for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "game_queue_insert_own" on public.game_queue
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "game_queue_update_own" on public.game_queue
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "game_queue_delete_own" on public.game_queue
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- Supabase's default privileges would also grant these tables to anon.
revoke all on table public.game_library from public, anon;
revoke all on table public.game_queue from public, anon;
grant select, insert, update, delete on table public.game_library to authenticated;
grant select, insert, update, delete on table public.game_queue to authenticated;

commit;

-- Picks the new tables up straight away instead of waiting for PostgREST.
notify pgrst, 'reload schema';
