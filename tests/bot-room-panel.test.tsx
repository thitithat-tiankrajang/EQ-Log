import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProBotStatus } from "../src/bot/catalog";

const { getMyProBotStatus } = vi.hoisted(() => ({ getMyProBotStatus: vi.fn() }));

vi.mock("../src/auth", () => ({
  useAuth: () => ({ profile: { display_name: "Ada Lovelace" } }),
}));
vi.mock("../src/features/probot/repository", () => ({ getMyProBotStatus }));

import { BotRoomPanel } from "../src/components/pages/pregame/BotRoomPanel";

function status(overrides: Partial<ProBotStatus> = {}): ProBotStatus {
  return {
    evaluated_at: "2026-09-28T00:00:00Z",
    plan_key: "plus",
    plan_name: "EQ Plus",
    plan_ends_at: null,
    allowance: { capacity: 3, available: 2, regen_minutes: 30, next_unit_at: null, reason: "ok" },
    weekly: { used: 1, cap: 30, remaining: 29, week_start: "", week_end: "" },
    credits: 4,
    boards: { active: 0, limit: 3 },
    ...overrides,
  };
}

describe("Authur room setup", () => {
  beforeEach(() => getMyProBotStatus.mockReset());
  afterEach(cleanup);

  it("defaults the player name, pre-selects available allowance and sends the funding choice", async () => {
    getMyProBotStatus.mockResolvedValue(status());
    const onSubmit = vi.fn();
    render(<BotRoomPanel engine="authur" busy={false} onSubmit={onSubmit} />);

    const name = screen.getByRole("textbox", { name: /name/i });
    expect(name).toHaveValue("Ada Lovelace");
    await waitFor(() =>
      expect(screen.getByRole("radio", { name: /ใช้โควตา Pro-Bot/ })).toHaveAttribute(
        "aria-checked",
        "true",
      ),
    );
    expect(screen.queryByRole("radiogroup", { name: "Difficulty" })).not.toBeInTheDocument();
    fireEvent.submit(name.closest("form")!);
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        playerB: "Authur",
        botEngine: "authur",
        botDifficulty: "super",
        botFunding: "allowance",
        tileDrawMode: "play",
      }),
    );
  });

  it("never spends a Credit unless the player selects it", async () => {
    getMyProBotStatus.mockResolvedValue(
      status({
        plan_key: "free",
        allowance: {
          capacity: 0,
          available: 0,
          regen_minutes: null,
          next_unit_at: null,
          reason: "free_plan",
        },
        weekly: { used: 0, cap: 0, remaining: 0, week_start: "", week_end: "" },
        credits: 2,
      }),
    );
    const onSubmit = vi.fn();
    render(<BotRoomPanel engine="authur" busy={false} onSubmit={onSubmit} />);

    const allowance = await screen.findByRole("radio", { name: /ใช้โควตา Pro-Bot/ });
    await waitFor(() => expect(allowance).toBeDisabled());
    expect(screen.getByText("แพ็กเกจ Free ไม่มีโควตา Pro-Bot")).toBeInTheDocument();
    const submit = screen.getByRole("button", { name: "Start Authur match" });
    expect(submit).toBeDisabled();
    fireEvent.submit(submit.closest("form")!);
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("radio", { name: /ใช้ 1 เครดิต/ }));
    fireEvent.submit(submit.closest("form")!);
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ botFunding: "credit" }));
  });

  it("explains an empty allowance and a full board count instead of starting", async () => {
    getMyProBotStatus.mockResolvedValue(
      status({
        allowance: {
          capacity: 3,
          available: 0,
          regen_minutes: 30,
          next_unit_at: "2026-09-28T01:30:00Z",
          reason: "empty",
        },
        credits: 0,
        boards: { active: 3, limit: 3 },
      }),
    );
    render(<BotRoomPanel engine="authur" busy={false} onSubmit={vi.fn()} />);
    expect(await screen.findByText(/โควตาหมดชั่วคราว/)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /ใช้ 1 เครดิต/ })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("ครบ 3 กระดาน");
    expect(screen.getByRole("button", { name: "Start Authur match" })).toBeDisabled();
  });
});
