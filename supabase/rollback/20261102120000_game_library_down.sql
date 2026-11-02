-- Undoes supabase/migrations/20261102120000_game_library.sql.
--
-- THIS PERMANENTLY DELETES every user's cloud copy of their Game Library:
-- Wishlists, collections, notes, progress, statuses and rankings. Copies on
-- devices survive and upload again if the migration is re-applied, but anything
-- only the cloud held is gone. Export the tables first if they may hold real data.
--
-- It touches nothing else. Kept out of supabase/migrations/ so that a migration
-- tool can never apply it by accident.

begin;

-- Dropping a table also drops its triggers and policies.
drop table if exists public.game_queue;
drop table if exists public.game_library;

drop function if exists public.game_queue_merge();
drop function if exists public.game_library_merge();

commit;

notify pgrst, 'reload schema';
