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
| `migrations/20261102120000_game_library.sql`    | Permanent schema change                            | After review                                                    |
| `tests/game_library_verify.sql`                 | Reads catalogs. Writes nothing                     | Anywhere                                                        |
| `tests/game_library_checks.sql`                 | Creates throwaway users and rows, then undoes them | Blank test project only. It refuses to run where accounts exist |
| `rollback/20261102120000_game_library_down.sql` | Deletes the tables and all their data              | Only to abandon the migration                                   |

## Applied

| Migration                     | Test project | Production  |
| ----------------------------- | ------------ | ----------- |
| `20261102120000_game_library` | not applied  | not applied |

## If the CLI is adopted later

The SQL Editor doesn't write to `supabase_migrations.schema_migrations`, so the
CLI would treat these files as unapplied and try to run them again. Mark each one
as applied first, for example:

```
supabase migration repair 20261102120000 --status applied
```

If the pre-flight reports that a project already has CLI history, stop and sort
that out before running anything by hand.
