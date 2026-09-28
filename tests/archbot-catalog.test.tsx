// ArchBot's identity and availability: the catalog decides whether it can be
// chosen, it is free (no funding of any kind is ever sent), players see the name
// ArchBot and never the internal Stage 5B identifiers, and its games carry
// ArchBot's own mode key rather than an Aether one.
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("../src/supabaseClient", () => ({
  isSupabaseConfigured: true,
  supabase: { rpc, auth: { getSession: async () => ({ data: { session: null } }) } },
}));
vi.mock("../src/auth", () => ({
  useAuth: () => ({ profile: { display_name: "Ada" }, userId: "user-1" }),
  AccountChip: () => null,
}));
vi.mock("../src/admin", () => ({ AdminButton: () => null, AdminPage: () => null }));
vi.mock("../src/components/pages/lobby/useMembersCatalog", () => ({
  useMembersCatalog: () => ({ error: null, loading: false, members: [] }),
}));
vi.mock("../src/components/pages/lobby/useRegisteredPlayersCatalog", () => ({
  useRegisteredPlayersCatalog: () => ({ error: null, loading: false, players: [] }),
}));

import { archBotOfferFrom, type CatalogBot } from "../src/bot/archbot/availability";
import { botDisplayName } from "../src/bot/archbot/identity";
import { botKeyFor } from "../src/bot/catalog";
import { CreateRoomPage } from "../src/components/pages/pregame/CreateRoomPage";
import { ArchBotRoomPanel } from "../src/components/pages/pregame/ArchBotRoomPanel";
import {
  deriveModeKey,
  isBotModeKey,
  isModeInProfileGroup,
  MODE_CATALOG,
} from "../src/features/gameRecords/domain";
import { defaultPlayTools } from "../src/playModeTools";
import type { NewGameSettings } from "../src/game";

const ENABLED: CatalogBot = {
  bot_key: "stage5b",
  display_name: "ArchBot",
  engine_family: "stage5b",
  difficulty: "stage5b64",
  execution_type: "CLIENT",
  access_tier: "free",
  enabled: true,
  new_rooms_allowed: true,
  lifecycle: "active",
  sort_order: 20,
};
// Exactly the row Phase 3 seeded.
const PENDING: CatalogBot = {
  ...ENABLED,
  display_name: "Stage 5B",
  enabled: false,
  new_rooms_allowed: false,
  lifecycle: "pending",
};

beforeEach(() => {
  rpc.mockReset();
  vi.stubGlobal("Worker", class {});
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("whether ArchBot is offered", () => {
  it("follows the catalog row and nothing else", () => {
    expect(archBotOfferFrom([ENABLED], true)).toEqual({ available: true });
    expect(archBotOfferFrom([PENDING], true)).toMatchObject({
      available: false,
      reason: "not_offered",
    });
    expect(archBotOfferFrom([], true)).toMatchObject({ available: false, reason: "not_offered" });
    for (const change of [
      { enabled: false },
      { new_rooms_allowed: false },
      { lifecycle: "retired" },
      // A client that can only run ArchBot for free on the device cannot honour
      // a catalog that says anything else.
      { execution_type: "SERVER" },
      { execution_type: "CLIENT_WASM" },
      { access_tier: "pro" },
    ]) {
      expect(
        archBotOfferFrom([{ ...ENABLED, ...change }], true),
        JSON.stringify(change),
      ).toMatchObject({ available: false, reason: "not_offered" });
    }
  });

  it("is not offered in a browser that cannot run it", () => {
    expect(archBotOfferFrom([ENABLED], false)).toMatchObject({
      available: false,
      reason: "unsupported",
    });
  });
});

function renderCreate(onCreate = vi.fn()) {
  return render(
    <CreateRoomPage
      canCreate
      createDisabledReason={null}
      visibility="public"
      regionAvailable
      regionId="region-1"
      regionName="North"
      submitting={false}
      onBack={vi.fn()}
      onCreate={onCreate}
      onCreateRanked={async () => undefined}
    />,
  );
}

describe("choosing ArchBot", () => {
  it("does not appear while the catalog keeps it pending", async () => {
    rpc.mockResolvedValue({ data: [PENDING], error: null });
    const user = userEvent.setup();
    const view = renderCreate();
    await user.click(view.getByRole("button", { name: /Public/ }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("list_bots"));
    expect(view.queryByRole("button", { name: /ArchBot/ })).not.toBeInTheDocument();
    expect(view.queryByText(/Stage 5B/)).not.toBeInTheDocument();
  });

  it("appears once the catalog opens it, and creates a free ArchBot room", async () => {
    rpc.mockResolvedValue({ data: [ENABLED], error: null });
    const onCreate = vi.fn();
    const user = userEvent.setup();
    const view = renderCreate(onCreate);
    await user.click(view.getByRole("button", { name: /Public/ }));
    await user.click(await view.findByRole("button", { name: /ArchBot/ }));
    await user.click(view.getByRole("button", { name: "Start ArchBot match" }));
    expect(onCreate).toHaveBeenCalledTimes(1);
    const settings = onCreate.mock.calls[0]![0] as NewGameSettings;
    expect(settings).toMatchObject({
      playerB: "ArchBot",
      botSide: "B",
      botEngine: "stage5b",
      botDifficulty: "stage5b64",
      tileDrawMode: "play",
    });
    // Free: no allowance, no Credit, no funding field at all.
    expect(settings.botFunding).toBeUndefined();
    expect(botKeyFor(settings)).toBe("stage5b");
    expect(view.queryByText(/Stage 5|stage5b|deepTop/i)).not.toBeInTheDocument();
  });
});

describe("the ArchBot setup panel", () => {
  it("says it is free and never asks how to pay", () => {
    render(<ArchBotRoomPanel busy={false} onSubmit={vi.fn()} />);
    expect(screen.getByTestId("archbot-free-note")).toHaveTextContent(
      "ไม่ใช้โควตา Pro-Bot หรือเครดิต",
    );
    expect(screen.queryByRole("radio", { name: /โควตา|เครดิต/ })).not.toBeInTheDocument();
  });

  it("keeps one creation request id across repeated submits", async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<ArchBotRoomPanel busy={false} onSubmit={onSubmit} />);
    await user.click(screen.getByRole("button", { name: "Start ArchBot match" }));
    await user.click(screen.getByRole("button", { name: "Start ArchBot match" }));
    expect(onSubmit.mock.calls[0]![0].creationRequestId).toBe(
      onSubmit.mock.calls[1]![0].creationRequestId,
    );
  });
});

describe("ArchBot's identity in records", () => {
  it("names the seat ArchBot, and only ArchBot", () => {
    expect(botDisplayName("stage5b")).toBe("ArchBot");
    expect(botDisplayName("authur")).toBe("Authur");
    expect(botDisplayName("aether")).toBe("Aether");
  });

  it("records ArchBot games under ArchBot's own mode, not an Aether one", () => {
    const game = {
      botSide: "B",
      botEngine: "stage5b",
      botDifficulty: "stage5b64",
      gameMode: "versus",
    };
    expect(deriveModeKey(game as never)).toBe("stage5b_standard");
    expect(deriveModeKey({ ...game, botEngine: "aether", botDifficulty: "hard" } as never)).toBe(
      "aether_hard",
    );
    expect(deriveModeKey({ ...game, botEngine: "authur" } as never)).toBe("authur_strong");
    expect(isBotModeKey("stage5b_standard")).toBe(true);
    expect(isModeInProfileGroup("stage5b_standard", "stage5b_standard")).toBe(true);
    expect(isModeInProfileGroup("stage5b_standard", "aether")).toBe(false);
    expect(MODE_CATALOG.find((mode) => mode.key === "stage5b_standard")?.label).toBe("ArchBot");
  });

  it("offers every bot-room tool but the bot explanation", () => {
    expect([...defaultPlayTools("stage5b_standard")].sort()).toEqual(
      ["analysis", "multiverse", "replay", "turn_log"].sort(),
    );
  });
});
