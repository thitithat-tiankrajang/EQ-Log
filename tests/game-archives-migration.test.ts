import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

const sql = readFileSync(`${process.cwd()}/supabase/game_archives_migration.sql`, "utf8");
const creatorAccess = readFileSync(
  `${process.cwd()}/supabase/archive_creator_access_migration.sql`,
  "utf8",
);
const runbook = readFileSync(`${process.cwd()}/GAME_RECORDS_ARCHITECTURE.md`, "utf8");

describe("game archive migration contract", () => {
  it("creates exactly the three agreed archive/library tables", () => {
    expect(sql).toContain("create table if not exists public.public_game_snapshots");
    expect(sql).toContain("create table if not exists public.region_game_snapshots");
    expect(sql).toContain("create table if not exists public.private_library_items");
  });

  it("records completion provenance required for bot-training filters", () => {
    expect(sql).toContain("completion_kind text not null");
    expect(sql).toContain("completion_reason text not null");
    expect(sql).toContain("where completion_kind = 'natural'");
    expect(sql).toContain("target_completion_kind");
  });

  it("exposes the source account needed by archive game tables", () => {
    const publicGrant = sql.match(
      /grant select \(([\s\S]*?)\) on table public\.public_game_snapshots to authenticated/i,
    )?.[1];
    const regionGrant = sql.match(
      /grant select \(([\s\S]*?)\) on table public\.region_game_snapshots to authenticated/i,
    )?.[1];
    expect(publicGrant).toContain("source_owner_id");
    expect(regionGrant).toContain("source_owner_id");
    expect(creatorAccess).toMatch(
      /grant select \(source_owner_id\)\s+on table public\.public_game_snapshots to authenticated/i,
    );
    expect(creatorAccess).toMatch(
      /grant select \(source_owner_id\)\s+on table public\.region_game_snapshots to authenticated/i,
    );
  });

  it("archives before deleting the live row and drops legacy rooms last", () => {
    const finalizer = sql.indexOf("create or replace function public.finalize_live_game");
    const archiveInsert = sql.indexOf("insert into public.public_game_snapshots", finalizer);
    const liveDelete = sql.indexOf(
      "delete from public.room_live where room_id = target_game_id",
      finalizer,
    );
    const legacyDrop = sql.indexOf("drop table public.rooms cascade");
    expect(finalizer).toBeGreaterThan(0);
    expect(archiveInsert).toBeGreaterThan(finalizer);
    expect(liveDelete).toBeGreaterThan(archiveInsert);
    expect(legacyDrop).toBeGreaterThan(liveDelete);
  });

  it("allows only the one-way admin move from Public to Region", () => {
    expect(sql).toContain("move_public_snapshot_to_region");
    expect(sql).toContain("move_public_snapshots_to_region");
    expect(sql).toContain("target_game_ids uuid[]");
    expect(sql).toContain("if not public.is_admin() then");
    expect(sql).toContain("get_public_archive_move_context");
    expect(sql).not.toContain("move_region_snapshot_to_public");
  });

  it("projects opponent availability without exposing participant identities", () => {
    expect(sql).toContain("has_opponent boolean");
    expect(sql).toContain("when l.creator_side = 'A' then l.player_b_user_id is not null");
    expect(sql).toContain("when l.creator_side = 'B' then l.player_a_user_id is not null");
  });

  it("stores only a join-code hash in realtime rows", () => {
    expect(sql).toContain("room_code_hash");
    expect(sql).toContain("derive_live_room_code");
    expect(sql).not.toContain("add column if not exists room_code text");
  });

  it("keeps the room-code secret in a client-inaccessible private table", () => {
    expect(sql).toContain("create schema if not exists private");
    expect(sql).toContain("create table if not exists private.runtime_secrets");
    expect(sql).toContain("from private.runtime_secrets");
    expect(sql).toContain("set search_path = pg_catalog, extensions, private");
    expect(sql).toContain(
      "revoke all on schema private from public, anon, authenticated, service_role",
    );
    expect(sql).toContain(
      "revoke all on table private.runtime_secrets from public, anon, authenticated, service_role",
    );
    expect(sql).not.toContain("current_setting('app.room_code_secret'");
    expect(sql).not.toMatch(/insert into private\.runtime_secrets/i);
    expect(sql).toMatch(
      /revoke all on function public\.derive_live_room_code\(uuid\)\s+from public, anon, authenticated, service_role/i,
    );
  });

  it("preflights the private secret before moving legacy data", () => {
    const preflight = sql.indexOf("perform public.derive_live_room_code(gen_random_uuid())");
    const dataMovement = sql.indexOf("insert into public.room_live");
    expect(preflight).toBeGreaterThan(0);
    expect(dataMovement).toBeGreaterThan(preflight);
    expect(sql).toContain("room_code_secret must contain at least 32 characters");
  });

  it("keeps deterministic HMAC-SHA256 room codes and the create/get/join hash flow", () => {
    const uuid = "11111111-2222-4333-8444-555555555555";
    const secret = "0123456789abcdef0123456789abcdef";
    const derive = () =>
      createHmac("sha256", secret).update(uuid, "utf8").digest("hex").slice(0, 12).toUpperCase();

    expect(derive()).toBe("38BA8FC799D7");
    expect(derive()).toBe(derive());
    expect(sql).toMatch(
      /upper\(substr\(encode\((?:extensions\.)?hmac\([\s\S]*?'sha256'[\s\S]*?1, 12\)\)/,
    );
    expect(sql).toContain("next_code := public.derive_live_room_code(next_id)");
    expect(sql).toMatch(
      /create or replace function public\.get_live_game_code[\s\S]*public\.derive_live_room_code\(target_game_id\)/,
    );
    expect(sql).toMatch(
      /create or replace function public\.join_live_game[\s\S]*room_code_hash = encode\((?:extensions\.)?digest\(/,
    );
  });

  it("documents secret provisioning separately from the committed migration", () => {
    expect(runbook).toContain("insert into private.runtime_secrets");
    expect(runbook).toContain("gen_random_uuid()");
    expect(runbook).not.toContain("replace-with-a-long-random-deployment-secret");
  });

  it("keeps browser mutations behind narrow live-game RPCs", () => {
    expect(sql).toContain("create or replace function public.update_live_game_state");
    expect(sql).toContain("create or replace function public.update_live_game_session");
    expect(sql).toContain("create or replace function public.sync_live_game_state");
    expect(sql).toContain("create or replace function public.cancel_live_game");
    expect(sql).toContain("create function public.list_live_games");
    expect(sql).toContain(
      "revoke all on function public.list_live_games(text, uuid)\n  from public, anon, authenticated, service_role",
    );
    const liveReadGrant = sql.match(
      /revoke all on table public\.room_live from anon, authenticated;\s*grant select\s*\(([\s\S]*?)\)\s*on table public\.room_live to authenticated/i,
    );
    expect(liveReadGrant).not.toBeNull();
    expect(liveReadGrant?.[1]).toMatch(/\bstate\b/i);
    expect(liveReadGrant?.[1]).toMatch(/\bsession\b/i);
    expect(liveReadGrant?.[1]).not.toMatch(/\broom_code_hash\b/i);
    expect(liveReadGrant?.[1]).not.toMatch(/\bprivate_parent_id\b/i);
    expect(sql).not.toMatch(/grant select on table public\.room_live to authenticated/i);
    expect(sql).not.toContain("grant select, update, delete on table public.room_live");
  });

  it("prevents another member from claiming Solo or Aether player seats", () => {
    expect(sql).toContain("solo and Aether games are spectator-only");
    expect(sql).toContain("live.state ->> 'botSide' is not null");
  });

  it("removes legacy finished rows from live storage after archiving them", () => {
    expect(sql).toMatch(
      /delete from public\.room_live l\s+using public\.rooms r[\s\S]*lifecycle_status, r\.status\) = 'finished'/,
    );
  });

  it("validates natural completion against the immutable final log", () => {
    expect(sql).toContain(
      "state_completion_reason := public.snapshot_completion_reason(target_state)",
    );
    expect(sql).toContain("natural completion does not match the final game log");
    expect(sql).toContain("surrender reason and side must be provided together");
  });

  it("keeps PL/pgSQL block terminators inside their dollar-quoted bodies", () => {
    expect(sql).not.toMatch(/\bend[\t ]+\$\$;/i);
  });
});
