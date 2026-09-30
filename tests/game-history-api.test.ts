import { describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("../src/supabaseClient", () => ({ supabase: { rpc } }));

import {
  historyCursor,
  listMyHistory,
  parseHistoryCursor,
} from "../src/features/gameRecords/history";

const id = "71000000-0000-4000-8000-000000000010";
const at = "2026-09-29T10:00:00.000Z";

describe("Me History client boundary", () => {
  it("validates the entire stable cursor before querying", async () => {
    expect(
      parseHistoryCursor(historyCursor({ completedAt: at, sourceKind: "normal", sourceId: id })),
    ).toEqual({ completedAt: at, sourceKind: "normal", sourceId: id });
    for (const bad of [
      "no",
      "[]",
      '["yesterday","normal","bad"]',
      `["${at}","unknown","${id}"]`,
      `["${at}","normal","${id}","extra"]`,
    ]) {
      await expect(listMyHistory(bad)).rejects.toThrow("Invalid History page cursor");
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("requests metadata only and paginates with a deterministic tuple", async () => {
    rpc.mockResolvedValueOnce({
      data: [0, 1, 2].map((n) => ({
        source_kind: "normal",
        source_id: `71000000-0000-4000-8000-00000000001${n}`,
        game_id: id,
        participant_side: "A",
        game_name: "Finished",
        mode_key: "online_versus",
        game_mode: "versus",
        opponent_label: "Other",
        bot_key: null,
        score_for: 12,
        score_against: 4,
        outcome: "win",
        completed_at: at,
        rules_version: null,
        result_authority: "client_reported",
        replay_availability: "unavailable",
        is_recent: n === 0,
      })),
      error: null,
    });
    const first = await listMyHistory(null, 2);
    expect(first.items).toHaveLength(2);
    expect(first.items[0]).toMatchObject({
      gameName: "Finished",
      replayAvailability: "unavailable",
      isRecent: true,
    });
    expect(first.nextCursor).toBe(historyCursor(first.items[1]!));
    expect(rpc).toHaveBeenCalledWith("list_my_game_history", {
      p_limit: 3,
      p_before_at: null,
      p_before_kind: null,
      p_before_id: null,
    });
    rpc.mockResolvedValueOnce({ data: [], error: null });
    await listMyHistory(first.nextCursor, 2);
    expect(rpc).toHaveBeenLastCalledWith("list_my_game_history", {
      p_limit: 3,
      p_before_at: at,
      p_before_kind: "normal",
      p_before_id: "71000000-0000-4000-8000-000000000011",
    });
  });
});
