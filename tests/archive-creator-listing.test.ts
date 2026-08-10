import { beforeEach, describe, expect, it, vi } from "vitest";

const { eq, from, order, range, select } = vi.hoisted(() => {
  const range = vi.fn();
  const chain = {
    eq: vi.fn(),
    order: vi.fn(),
    range,
  };
  chain.eq.mockReturnValue(chain);
  chain.order.mockReturnValue(chain);
  const select = vi.fn(() => chain);
  return {
    eq: chain.eq,
    from: vi.fn(() => ({ select })),
    order: chain.order,
    range,
    select,
  };
});

vi.mock("../src/supabaseClient", () => ({
  supabase: { from },
}));

import { listArchiveGames } from "../src/features/gameRecords/repository";

const row = {
  game_id: "11111111-2222-4333-8444-555555555555",
  source_owner_id: "22222222-2222-4222-8222-222222222222",
  creator: { display_name: "Creator Account" },
  name: "Archived game",
  player_a: "Alice",
  player_b: "Bob",
  game_mode: "versus",
  mode_key: "local_versus",
  turn_number: 4,
  score_a: 10,
  score_b: 8,
  completion_kind: "terminated",
  completion_reason: "manual",
  surrendered_side: null,
  created_at: "2026-08-10T00:00:00.000Z",
  finished_at: "2026-08-10T00:30:00.000Z",
  archived_at: "2026-08-10T00:30:00.000Z",
};

describe("archive creator listing", () => {
  beforeEach(() => {
    from.mockClear();
    select.mockClear();
    eq.mockClear();
    order.mockClear();
    range.mockReset();
  });

  it("resolves and maps the source account for public history", async () => {
    range.mockResolvedValue({ data: [row], error: null, count: 1 });

    const result = await listArchiveGames("public", null);

    expect(from).toHaveBeenCalledWith("public_game_snapshots");
    expect(select.mock.calls[0]?.[0]).toContain(
      "creator:profiles!public_game_snapshots_source_owner_id_fkey(display_name)",
    );
    expect(result.games[0]?.creatorName).toBe("Creator Account");
  });

  it("uses the region snapshot creator relationship without changing region filtering", async () => {
    range.mockResolvedValue({ data: [{ ...row, region_id: "region-1" }], error: null, count: 1 });

    await listArchiveGames("region", "region-1");

    expect(from).toHaveBeenCalledWith("region_game_snapshots");
    expect(select.mock.calls[0]?.[0]).toContain(
      "creator:profiles!region_game_snapshots_source_owner_id_fkey(display_name)",
    );
    expect(eq).toHaveBeenCalledWith("region_id", "region-1");
  });
});
