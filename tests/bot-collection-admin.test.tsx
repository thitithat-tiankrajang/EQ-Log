import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("../src/supabaseClient", () => ({
  isSupabaseConfigured: true,
  supabase: { rpc },
}));

import {
  BotCollectionAdminPanel,
  type AdminBotRow,
} from "../src/components/admin/BotCollectionAdminPanel";

function row(overrides: Partial<AdminBotRow>): AdminBotRow {
  return {
    bot_key: "authur_strong",
    display_name: "Authur",
    engine_family: "authur",
    difficulty: "super",
    mode_key: "authur_strong",
    execution_type: "SERVER",
    access_tier: "free",
    access_tier_status: "provisional",
    enabled: true,
    new_rooms_allowed: true,
    lifecycle: "active",
    config_version: 1,
    sort_order: 10,
    updated_at: "2026-09-27T00:00:00.000Z",
    live_rooms: 4,
    ...overrides,
  };
}

describe("Admin Bot Collection", () => {
  beforeEach(() => {
    rpc.mockReset();
  });
  afterEach(cleanup);

  it("lists the catalog and marks the seeded tier as a provisional default", async () => {
    rpc.mockResolvedValue({
      data: [
        row({}),
        row({
          bot_key: "aether_max",
          display_name: "Aether Max",
          engine_family: "aether",
          difficulty: "max",
          new_rooms_allowed: false,
          lifecycle: "retired",
          live_rooms: 0,
        }),
      ],
      error: null,
    });
    render(<BotCollectionAdminPanel />);

    const authur = await screen.findByText("Authur");
    const card = authur.closest("article")!;
    expect(
      within(card).getByText(/Free \(provisional default\) · Active product/),
    ).toBeInTheDocument();
    expect(within(card).getByText("enabled")).toBeInTheDocument();
    expect(
      screen.getByText(/Retired · legacy rooms only · closed to new games/),
    ).toBeInTheDocument();
    expect(rpc).toHaveBeenCalledWith("admin_list_bots");
  });

  it("disables a bot only with a reason, through the audited RPC", async () => {
    rpc.mockImplementation(async (name: string) =>
      name === "admin_list_bots" ? { data: [row({})], error: null } : { data: null, error: null },
    );
    const user = userEvent.setup();
    render(<BotCollectionAdminPanel />);

    await user.click(await screen.findByRole("button", { name: "Disable" }));
    await user.type(screen.getByRole("textbox"), "Engine incident");
    await user.click(screen.getByRole("button", { name: "Disable bot" }));

    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("admin_set_bot_enabled", {
        target_bot_key: "authur_strong",
        target_enabled: false,
        target_reason: "Engine incident",
      }),
    );
  });

  it("shows the database's refusal to a non-administrator", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "admin access required" } });
    render(<BotCollectionAdminPanel />);
    expect(await screen.findByRole("alert")).toHaveTextContent("admin access required");
  });
});
