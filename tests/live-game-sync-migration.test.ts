import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  `${process.cwd()}/supabase/live_game_sync_repair_migration.sql`,
  "utf8",
);

describe("live game sync repair migration", () => {
  it("writes state and its matching session in one room update", () => {
    const body = migration.match(
      /create or replace function public\.sync_live_game_state[\s\S]*?end; \$\$;/i,
    )?.[0];
    expect(body).toBeTruthy();
    expect(body?.match(/update public\.room_live/g)).toHaveLength(1);
    expect(body).toContain("state = public.sanitize_game_snapshot(target_state)");
    expect(body).toContain("session = clean_session");
    expect(body).toContain("actor_id = auth.uid()");
  });

  it("ignores a delayed draft older than the stored session", () => {
    expect(migration).toContain(
      "coalesce(session ->> 'updatedAt', '') <= coalesce(clean_session ->> 'updatedAt', '')",
    );
  });

  it("exposes both sync RPCs only to authenticated clients", () => {
    expect(migration).toContain(
      "revoke all on function public.sync_live_game_state(uuid, jsonb, jsonb)\n  from public, anon, authenticated, service_role",
    );
    expect(migration).toContain(
      "revoke all on function public.update_live_game_session(uuid, jsonb)\n  from public, anon, authenticated, service_role",
    );
  });
});
