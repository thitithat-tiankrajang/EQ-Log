import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const followUp = readFileSync(
  `${process.cwd()}/supabase/room_live_access_contract_migration.sql`,
  "utf8",
);
const repair = readFileSync(`${process.cwd()}/supabase/room_live_function_acl_repair.sql`, "utf8");
const localBootstrap = readFileSync(
  `${process.cwd()}/supabase/tests/local_supabase_bootstrap.sql`,
  "utf8",
);

describe("room_live access follow-up migration", () => {
  it("keeps anon denied and gives authenticated only the columns required for an opened game", () => {
    expect(followUp).toContain("revoke all on table public.room_live from anon, authenticated");
    expect(followUp).not.toMatch(/grant\s+select[\s\S]*?room_live\s+to\s+anon/i);

    const columnGrant = followUp.match(
      /grant select \(([\s\S]*?)\) on table public\.room_live to authenticated/i,
    )?.[1];
    expect(columnGrant).toBeTruthy();
    expect(columnGrant).toContain("state");
    expect(columnGrant).toContain("session");
    expect(columnGrant).not.toContain("room_code_hash");
    expect(columnGrant).not.toContain("private_parent_id");
  });

  it("exposes lobby data only through an authenticated safe-summary RPC", () => {
    expect(followUp).toContain("create function public.list_live_games");
    expect(followUp).toContain("approved membership required");
    expect(followUp).toContain(
      "revoke all on function public.list_live_games(text, uuid)\n  from public, anon, authenticated, service_role",
    );
    expect(followUp).toContain(
      "grant execute on function public.list_live_games(text, uuid) to authenticated",
    );

    const returnColumns = followUp.match(/returns table \(([\s\S]*?)\)\s*language plpgsql/i)?.[1];
    expect(returnColumns).toBeTruthy();
    expect(returnColumns).toContain("viewer_role text");
    expect(returnColumns).toContain("can_manage boolean");
    expect(returnColumns).toContain("has_opponent boolean");
    expect(returnColumns).not.toContain("state jsonb");
    expect(returnColumns).not.toContain("session jsonb");
    expect(returnColumns).not.toContain("player_a_user_id");
    expect(returnColumns).not.toContain("player_b_user_id");
    expect(returnColumns).not.toContain("room_code_hash");
  });

  it("provides an idempotent ACL-only repair for deployments that already migrated", () => {
    expect(repair).toContain(
      "revoke all on function public.list_live_games(text, uuid)\n  from public, anon, authenticated, service_role",
    );
    expect(repair).toContain(
      "grant execute on function public.list_live_games(text, uuid) to authenticated",
    );
    expect(repair).not.toMatch(/\b(?:create|alter|drop)\s+(?:table|policy)\b/i);
    expect(repair).toContain("anon still has EXECUTE on list_live_games");
  });

  it("models Supabase explicit default function grants in local database tests", () => {
    expect(localBootstrap).toMatch(
      /alter default privileges in schema public\s+grant execute on functions to anon, authenticated, service_role/i,
    );
  });
});
