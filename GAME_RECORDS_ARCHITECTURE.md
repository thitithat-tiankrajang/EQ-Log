# Game records deployment runbook

EQ Lab separates mutable Live Games from immutable Game Snapshots. `room_live` contains only waiting, playing, or paused games. Finishing a game calls one database transaction that writes Public, Region, Private, or no snapshot, updates lifetime profile aggregates, applies retention, and deletes the live row.

## Storage model

- `public_game_snapshots`: approved-member history, default retention 100,000.
- `region_game_snapshots`: current-region history, default retention 1,000 per Region.
- `private_library_items`: owner-only folder tree and immutable replay payloads, default board quota 1,000 per account.
- `user_mode_stats`: durable aggregates independent from archive retention.
- `system_settings`: deployment-managed limits.

`completion_kind = 'natural'` is the only supported bot-training filter. Surrender, manual stop, administrative stop, timeout, disconnect, and legacy endings remain recorded with `completion_kind = 'terminated'` and an explicit `completion_reason`.

## Staging deployment

1. Take a Supabase database backup and verify restore access.
2. Provision the private database join-code secret separately from the committed migration. Do not put the value in the frontend environment. The copyable template is `supabase/room_code_secret_setup.example.sql`; run it once in the Supabase SQL Editor before `game_archives_migration.sql`:

   ```sql
   create schema if not exists private;
   revoke all on schema private from public, anon, authenticated, service_role;

   create table if not exists private.runtime_secrets (
     key text primary key,
     value text not null,
     updated_at timestamptz not null default now(),
     constraint runtime_secrets_key_check check (key = 'room_code_secret'),
     constraint runtime_secrets_value_length_check check (length(value) >= 32)
   );

   alter table private.runtime_secrets enable row level security;
   revoke all on table private.runtime_secrets
     from public, anon, authenticated, service_role;

   insert into private.runtime_secrets (key, value)
   values (
     'room_code_secret',
     replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
   )
   on conflict (key) do nothing;
   ```

   This generates the secret inside PostgreSQL, so no production value is committed to the repository. Do not rotate it while Live Games exist: changing it changes every deterministic room code. The archive migration intentionally aborts before moving data if this row is absent or shorter than 32 characters.

3. Apply migrations in this order:

   ```text
   supabase/schema.sql                         # new installations only
   supabase/user_invites_migration.sql
   supabase/region_visibility_migration.sql
   supabase/game_archives_migration.sql
   ```

4. The archive migration runs in one transaction. It migrates every unfinished legacy room to `room_live`, migrates every finished legacy room to Public History, backfills lifetime statistics, and drops `rooms` only after verification.
5. Deploy the frontend only after the migration commits.

## Follow-up for an existing archive deployment

If `game_archives_migration.sql` was already applied before the member-only Live Game read contract was added, review and apply only:

```text
supabase/room_live_access_contract_migration.sql
supabase/archive_bulk_move_migration.sql
supabase/archive_creator_access_migration.sql
```

The Live Game migration does not grant `anon` access. It adds the authenticated-only `list_live_games` safe-summary RPC (including the derived `has_opponent` flag), keeps RLS as the row-visibility boundary, and replaces table-wide authenticated `SELECT` with an explicit opened-game column list that excludes `room_code_hash`, `private_parent_id`, and internal expiry fields. The archive migration adds the server-authorized admin context and atomic multi-snapshot Public-to-Region move. Deploy the matching frontend only after both SQL transactions commit; signed-out visitors remain on the sign-in screen and never query game storage.

The archive creator migration exposes only `source_owner_id` to authenticated
archive readers so the game tables can resolve the original creator's public
profile display name. It does not expose player account ids or profile email.

If an earlier version of that follow-up was already applied and `anon` still has an explicit `EXECUTE` grant on `list_live_games`, apply `supabase/room_live_function_acl_repair.sql`. Supabase projects can assign explicit default function grants to API roles; `REVOKE ... FROM PUBLIC` does not remove a grant made directly to `anon`. The repair is transactional, changes only this function ACL, verifies the final role contract, and leaves tables, policies, and RLS unchanged.

## Required maintenance jobs

Schedule these trusted database functions from Supabase Cron or the deployment scheduler. They are not executable by browser roles.

```sql
select public.cleanup_expired_live_games();
select public.cleanup_private_library_trash();
```

Recommended cadence: expired Live Games every 15 minutes; Private Trash daily. Public and Region retention is enforced synchronously at finalization and immediately when limits are lowered.

## Changing limits

An administrator can change all game limits atomically:

```sql
select public.set_game_storage_limits(100000, 1000, 1000);
```

The first value is the global Public maximum, the second is the common per-Region maximum, and the third is the per-account Private board quota. Lowering Public or Region limits prunes oldest snapshots immediately. Lowering Private never deletes personal files; it only blocks additional saves until usage is within quota.

## Post-deployment verification

```sql
select to_regclass('public.rooms') is null as legacy_rooms_removed;
select count(*) from public.room_live;
select count(*) from public.public_game_snapshots;
select region_id, count(*) from public.region_game_snapshots group by region_id;
select owner_id, count(*) filter (where item_type = 'game')
from public.private_library_items group by owner_id;
select completion_kind, completion_reason, count(*)
from public.public_game_snapshots group by completion_kind, completion_reason;
```

Verify in staging that a natural finish, surrender, Public game, Region game, Private Saved game, and Private Ephemeral game each reach the expected destination. Also verify that an Admin can move a finished Public snapshot into a selected Region and that no reverse operation is exposed.
