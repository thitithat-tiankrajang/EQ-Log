// The parked-lines migration, read as text. The behaviour itself is proven against a real
// Postgres by supabase/tests/multiverse_timeline_smoke.sql; this pins the contract so an edit
// that would quietly weaken it fails in CI, where no database runs.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  `${process.cwd()}/supabase/multiverse_timeline_migration.sql`,
  "utf8",
);

function functionBody(name: string): string {
  const body = migration.match(
    new RegExp(`create or replace function public\\.${name}[\\s\\S]*?\\$\\$;`, "i"),
  )?.[0];
  expect(body, `${name} should be defined`).toBeTruthy();
  return body!;
}

describe("multiverse timeline migration", () => {
  it("runs as one transaction", () => {
    const statements = migration
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("--"));
    expect(statements[0]).toBe("begin;");
    expect(statements).toContain("commit;");
  });

  it("keeps parked lines beside the live row, and gone with it", () => {
    expect(migration).toMatch(
      /game_id\s+uuid primary key references public\.room_live\(room_id\) on delete cascade/,
    );
  });

  it("lets readers read and nobody write the table directly", () => {
    expect(migration).toContain(
      "revoke all on table public.game_timelines from public, anon, authenticated;",
    );
    expect(migration).toContain("grant select on table public.game_timelines to authenticated;");
    expect(migration).toContain("using (public.can_read_live_game(game_id))");
    expect(migration).not.toMatch(/grant (insert|update|delete)[^;]*game_timelines/i);
  });

  it("never publishes parked lines to Realtime", () => {
    expect(migration).not.toMatch(/alter publication[^;]*game_timelines/i);
  });

  it("moves the position and the lines in one conditional commit", () => {
    const body = functionBody("commit_live_game_timeline");
    expect(body).toContain("public.commit_live_game_command(");
    expect(body).toContain("'timeline_conflict'");
    expect(body).toContain("'duplicate'");
    // The position must name the document it lands with.
    expect(body).toContain("target_state #>> '{timelineRef,version}'");
    // Game row first, lines second: one lock order for every writer.
    expect(
      body.indexOf("from public.room_live where room_id = target_game_id for update"),
    ).toBeLessThan(
      body.indexOf("from public.game_timelines t where t.game_id = target_game_id for update"),
    );
  });

  it("lets pruning remove lines and nothing else", () => {
    const body = functionBody("update_live_game_timeline");
    expect(body).toContain("pruning may only remove parked lines");
    expect(body).not.toContain("commit_live_game_command");
  });

  it("carries the lines into the archive only for the game's own writer", () => {
    const body = functionBody("attach_game_timeline_to_archive");
    expect(body).toContain("public.can_write_live_game(new.game_id)");
    expect(body).toContain("new.snapshot ? 'timeline'");
    for (const table of [
      "public_game_snapshots",
      "region_game_snapshots",
      "private_library_items",
    ]) {
      expect(migration).toContain(`before insert on public.${table}`);
    }
  });

  it("grants the write functions to signed-in members only", () => {
    expect(migration).toMatch(
      /revoke all on function public\.commit_live_game_timeline\([\s\S]*?\) from public, anon, authenticated, service_role;/,
    );
    expect(migration).toMatch(
      /grant execute on function public\.commit_live_game_timeline\([\s\S]*?\) to authenticated;/,
    );
    expect(migration).toContain(
      "grant execute on function public.update_live_game_timeline(uuid, jsonb, bigint) to authenticated;",
    );
  });
});
