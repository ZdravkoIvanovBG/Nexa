# Supabase schema changes

Nexa has no Supabase CLI setup, and the schema that existed before the Game
Library was never committed. Changes are applied by hand in the SQL Editor, so
the files here and the table below are the record of what has been run.

## Rules

- `migrations/` is append-only. Once a file has been applied to a project you are
  keeping, never edit it: add a new file with a later timestamp.
- Run a migration file exactly as committed, as one paste, with the role set to
  `postgres`. Don't pick out statements.
- Record every run in the table below, in the same change as the code that needs it.
- A failed migration has already rolled itself back. Don't mark it as applied.

## Scripts

| File                                            | What it does                                       | Where it may run                                                |
| ----------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------- |
| `tests/game_library_preflight.sql`              | Reads catalogs. Writes nothing                     | Anywhere                                                        |
| `migrations/20261102120000_game_library.sql`    | Permanent schema change                            | Already applied everywhere it needs to be. Don't run it again   |
| `tests/game_library_verify.sql`                 | Reads catalogs. Writes nothing                     | Anywhere                                                        |
| `tests/game_library_checks.sql`                 | Creates throwaway users and rows, then undoes them | Blank test project only. It refuses to run where accounts exist |
| `rollback/20261102120000_game_library_down.sql` | Deletes the tables and all their data              | Only to abandon the migration                                   |

## Applied

| Migration                     | Test project       | Production         |
| ----------------------------- | ------------------ | ------------------ |
| `20261102120000_game_library` | applied 2026-11-02 | applied 2026-11-02 |

This migration is live, so it is now frozen. Any change to these tables needs a new
migration file.

### `20261102120000_game_library`

Applied from commit `b935d789`. The test project is the separate "Nexa Game Library
Test" Supabase project, which holds no Nexa data.

| Check                       | Test project                       | Production                         |
| --------------------------- | ---------------------------------- | ---------------------------------- |
| PostgreSQL                  | 17.11                              | 17.6                               |
| Pre-flight                  | no `STOP`                          | no `STOP` or `REVIEW`              |
| Migration                   | succeeded                          | succeeded                          |
| `game_library_verify.sql`   | 15 ok, 0 STOP                      | 15 ok, 0 STOP                      |
| `game_library_checks.sql`   | 40 passed, 0 failed                | not run, by design                 |
| CLI migration history       | none                               | none                               |
| Game library fingerprint    | `9dacbb653b65fe68453ed79cb033183f` | `9dacbb653b65fe68453ed79cb033183f` |
| Existing schema fingerprint | `fb24fb51c611e9077eeca019cfbf830d` | `f5c39828a3cf60adcaddd5ebf79fd8c8` |

The matching game library fingerprints show production has the definitions that
passed the behaviour tests on the test project. Production's existing schema
fingerprint was the same before and after the migration, so its existing tables,
policies and triggers were not changed. The two existing schema fingerprints differ
because the test project has no Nexa tables.

## If the CLI is adopted later

The SQL Editor doesn't write to `supabase_migrations.schema_migrations`, so the
CLI would treat these files as unapplied and try to run them again. Mark each one
as applied first, for example:

```
supabase migration repair 20261102120000 --status applied
```

If the pre-flight reports that a project already has CLI history, stop and sort
that out before running anything by hand.
