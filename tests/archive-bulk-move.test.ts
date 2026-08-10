import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("../src/supabaseClient", () => ({
  isSupabaseConfigured: true,
  supabase: { rpc },
}));

import {
  getPublicArchiveMoveContext,
  movePublicArchivesToRegion,
} from "../src/features/gameRecords/repository";

const migration = readFileSync(`${process.cwd()}/supabase/archive_bulk_move_migration.sql`, "utf8");

describe("archive bulk move repository", () => {
  beforeEach(() => rpc.mockReset());

  it("uses the server response as the admin capability source", async () => {
    rpc.mockResolvedValue({
      data: {
        can_move: true,
        regions: [{ id: "region-1", name: "North" }],
      },
      error: null,
    });

    await expect(getPublicArchiveMoveContext()).resolves.toEqual({
      canMove: true,
      regions: [{ id: "region-1", name: "North" }],
    });
    expect(rpc).toHaveBeenCalledWith("get_public_archive_move_context");
  });

  it("moves all selected games through one bulk RPC call", async () => {
    rpc.mockResolvedValue({ data: 2, error: null });

    await movePublicArchivesToRegion(["game-1", "game-2", "game-1"], "region-1");

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("move_public_snapshots_to_region", {
      target_game_ids: ["game-1", "game-2"],
      target_region_id: "region-1",
    });
  });

  it("ships an existing-deployment migration with server-side admin enforcement", () => {
    expect(migration).toContain("get_public_archive_move_context");
    expect(migration).toContain("move_public_snapshots_to_region");
    expect(migration).toContain("if not public.is_admin() then");
    expect(migration).toContain("for update");
    expect(migration).toContain("notify pgrst, 'reload schema'");
  });
});
