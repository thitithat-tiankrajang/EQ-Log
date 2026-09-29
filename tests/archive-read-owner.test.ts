import { describe, expect, it, vi } from "vitest";

const selects = vi.hoisted(() => [] as { table: string; columns: string }[]);

vi.mock("../src/supabaseClient", () => ({
  isSupabaseConfigured: true,
  supabase: {
    from: (table: string) => ({
      select: (columns: string) => {
        selects.push({ table, columns });
        const query = {
          eq: () => query,
          maybeSingle: async () => ({ data: null, error: null }),
        };
        return query;
      },
    }),
  },
}));

import { readRoom } from "../src/remoteRooms";

describe("reading a finished game back", () => {
  it("leaves archive replay to the trusted endpoint after the live room disappears", async () => {
    expect(await readRoom("77777777-7777-4777-8777-777777777777")).toBeNull();
    expect(selects.map((entry) => entry.table)).toEqual(["room_live"]);
    expect(selects[0]?.columns).not.toContain("snapshot");
  });
});
