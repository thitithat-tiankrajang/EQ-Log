import { readFileSync, readdirSync } from "node:fs";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("../src/supabaseClient", () => ({ supabase: { rpc }, isSupabaseConfigured: true }));

import {
  ARCHBOT_BOT_KEY,
  botDisplayName,
  catalogBotKeyFor,
  loadBotNames,
  resetBotNames,
  useBotNames,
} from "../src/bot/botIdentity";

function Name({ id }: { id: string }) {
  const botName = useBotNames();
  return <span>{botName(id) ?? "no bot"}</span>;
}

beforeEach(() => {
  resetBotNames();
  rpc.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("internal identities", () => {
  it("map the Stage 5B solver, level and mode to the catalogue bot", () => {
    expect(catalogBotKeyFor("stage5b")).toBe(ARCHBOT_BOT_KEY);
    expect(catalogBotKeyFor("stage5b64")).toBe(ARCHBOT_BOT_KEY);
    expect(catalogBotKeyFor("stage5b_standard")).toBe(ARCHBOT_BOT_KEY);
    // The catalogue key itself is unchanged: ArchBot is a name, not a key.
    expect(ARCHBOT_BOT_KEY).toBe("stage5b");
  });

  it("leave everything else alone, including the Stage progression mode", () => {
    for (const id of [
      "stage",
      "survival",
      "survival_playtest",
      "study_puzzle",
      "authur_strong",
      "sim",
      "max",
      "toString",
      "",
      null,
      undefined,
    ]) {
      expect(catalogBotKeyFor(id), String(id)).toBeNull();
      expect(botDisplayName(id, null), String(id)).toBeNull();
    }
  });
});

describe("names come from the server catalogue", () => {
  it("uses the catalogue's display name whenever it has one", () => {
    const names = new Map([[ARCHBOT_BOT_KEY, "Catalogue Name"]]);
    expect(botDisplayName("stage5b64", names)).toBe("Catalogue Name");
  });

  it("falls back to ArchBot only when the catalogue cannot be read", () => {
    expect(botDisplayName("stage5b64", null)).toBe("ArchBot");
    expect(botDisplayName("stage5b", new Map())).toBe("ArchBot");
    expect(botDisplayName("stage5b", new Map([[ARCHBOT_BOT_KEY, "  "]]))).toBe("ArchBot");
  });

  it("reads list_bots once and shows its name", async () => {
    rpc.mockResolvedValue({
      data: [
        { bot_key: "authur_strong", display_name: "Authur" },
        { bot_key: "stage5b", display_name: "Catalogue Name" },
      ],
      error: null,
    });
    render(<Name id="stage5b64" />);
    await waitFor(() => expect(screen.getByText("Catalogue Name")).toBeVisible());
    render(<Name id="stage5b_standard" />);
    expect(screen.getAllByText("Catalogue Name")).toHaveLength(2);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("list_bots");
  });

  it("keeps the fallback on a failed read and tries again next time", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: new Error("offline") });
    expect((await loadBotNames()).size).toBe(0);
    rpc.mockResolvedValueOnce({
      data: [{ bot_key: "stage5b", display_name: "ArchBot" }],
      error: null,
    });
    expect((await loadBotNames()).get("stage5b")).toBe("ArchBot");
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});

describe("the C2 catalogue migration", () => {
  const migrations = readdirSync(`${process.cwd()}/supabase/migrations`).sort();
  const file = "20260930100000_archbot_display_identity.sql";
  const sql = readFileSync(`${process.cwd()}/supabase/migrations/${file}`, "utf8");
  const statements = sql.replace(/--.*$/gm, "");

  it("runs after every Phase 3 migration", () => {
    expect(migrations.at(-1)).toBe(file);
    expect(migrations).toContain("20260929140000_room_creation_charging.sql");
  });

  it("changes only the two display values, for the stage5b bot and its mode", () => {
    expect(statements).toMatch(/set display_name = 'ArchBot', updated_at = now\(\)/);
    expect(statements).toMatch(/set label = 'ArchBot'\s+where mode_key = 'stage5b_standard'/);
    expect(statements).toMatch(/where bot_key = 'stage5b' and display_name is distinct from/);
    // Every column any UPDATE assigns, read from the SET lists alone.
    const assigned = [...statements.matchAll(/\bset\s+([\s\S]*?)\s+(?:from|where|returning)\b/gi)]
      .flatMap((match) => match[1].split(","))
      .map((assignment) => assignment.split("=")[0].trim());
    expect(assigned.sort()).toEqual(["display_name", "label", "updated_at"]);
    expect(statements).not.toMatch(/create (or replace )?function|grant |revoke |policy|trigger/i);
  });

  it("records the rename in the catalogue audit trail", () => {
    expect(statements).toMatch(/insert into public\.bot_catalog_audit/);
    expect(statements).toMatch(/'update', to_jsonb\(b\), to_jsonb\(r\)/);
  });
});
