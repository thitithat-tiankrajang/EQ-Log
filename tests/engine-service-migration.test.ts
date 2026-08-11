import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(`${process.cwd()}/supabase/engine_service_migration.sql`, "utf8");

function functionBody(name: string): string {
  const body = migration.match(
    new RegExp(`create or replace function public\\.${name}[\\s\\S]*?\\$\\$;`, "i"),
  )?.[0];
  expect(body, `${name} should be defined`).toBeTruthy();
  return body!;
}

describe("engine service migration", () => {
  it("runs as one transaction so a partial upgrade cannot be left behind", () => {
    const statements = migration
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("--"));
    expect(statements[0]).toBe("begin;");
    expect(statements.at(-1)).toBe("commit;");
  });

  it("terminates PL/pgSQL blocks before the dollar quote closes", () => {
    expect(migration).not.toMatch(/\bend[\t ]+\$\$;/i);
  });

  it("promotes bot configuration to real columns", () => {
    // While `botSide` lived only in the client-written state blob, "is it the
    // bot's turn" was a client opinion — and the analysis permission rule rests
    // entirely on that answer.
    expect(migration).toContain("add column if not exists bot_side text");
    expect(migration).toContain("add column if not exists bot_difficulty text");
  });

  it("requires bot side and difficulty to be set together or not at all", () => {
    expect(migration).toContain("room_live_bot_config_check");
    expect(migration).toMatch(/bot_side is null and bot_difficulty is null/);
    expect(migration).toMatch(/bot_side in \('A', 'B'\) and bot_difficulty in/);
  });

  it("freezes bot configuration after the game is created", () => {
    // Without this, a player could flip `bot_side` to their own side and have
    // the server play their turn for them under the bot endpoint.
    const body = functionBody("freeze_live_bot_config");
    expect(body).toContain("new.bot_side is distinct from old.bot_side");
    expect(body).toContain("new.bot_difficulty is distinct from old.bot_difficulty");
    expect(body).toMatch(/raise exception 'bot configuration is fixed/);
    expect(migration).toContain("before update on public.room_live");
  });

  it("derives bot configuration once, on insert", () => {
    const body = functionBody("derive_live_bot_config");
    expect(body).toContain("new.state ->> 'botSide'");
    expect(migration).toContain("before insert on public.room_live");
  });

  it("decides turn control by composing with the existing write policy", () => {
    // The point is to have ONE permission model. If this function re-derived
    // read access instead of calling can_write_live_game, region and approval
    // rules would have a second home to drift from.
    const body = functionBody("controls_live_game_side");
    expect(body).toContain("public.can_write_live_game(l.room_id)");
  });

  it("keeps a direct room's seats private to their own players", () => {
    // A direct room has no gameplay host: ownership and admin must not reach
    // across the table.
    const body = functionBody("controls_live_game_side");
    const directBranch = body.slice(body.indexOf("'direct'"));
    expect(directBranch).toContain("player_a_user_id");
    const beforeHosted = directBranch.slice(0, directBranch.indexOf("when l.player_a_user_id"));
    expect(beforeHosted).not.toContain("is_admin");
  });

  it("gates the engine context on the existing read policy", () => {
    const body = functionBody("get_live_game_engine_context");
    expect(body).toContain("public.can_read_live_game(target_game_id)");
    expect(body).toContain("security definer");
  });

  it("reports whether the side on move is the bot, from the column not the blob", () => {
    const body = functionBody("get_live_game_engine_context");
    expect(body).toMatch(/l\.bot_side is not null and l\.bot_side = l\.canonical ->> 'activeSide'/);
  });

  it("reports whether the caller controls the side on move", () => {
    const body = functionBody("get_live_game_engine_context");
    expect(body).toContain(
      "public.controls_live_game_side(l.room_id, l.canonical ->> 'activeSide')",
    );
  });

  it("grants the new functions to authenticated users only", () => {
    for (const name of [
      "public.controls_live_game_side(uuid, text)",
      "public.get_live_game_engine_context(uuid)",
    ]) {
      expect(migration).toContain(`revoke all on function ${name}`);
      expect(migration).toContain(`grant execute on function ${name} to authenticated`);
    }
    expect(migration).not.toMatch(
      /grant execute on function public\.(controls_live_game_side|get_live_game_engine_context)[^\n]*to anon/,
    );
  });

  it("reloads PostgREST so the new functions are callable immediately", () => {
    expect(migration).toContain("notify pgrst, 'reload schema'");
  });
});
