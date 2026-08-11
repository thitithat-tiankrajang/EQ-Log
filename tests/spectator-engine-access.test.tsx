// A spectator watches. The engine migration must not have given them anything
// new — not a move, not an analysis, and not a reason for the app to behave
// differently while they watch.
//
// The backend is the authority here and refuses a spectator outright (see the
// service's own suite). What this file covers is the other half: that the
// client does not OFFER it, does not spend a request discovering it is refused,
// and that a spectator's view of a game is unchanged by any of it.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requestAnalysis = vi.fn();
const attachAnalysis = vi.fn();
const cancelAnalysis = vi.fn();

vi.mock("../src/bot/engineApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/bot/engineApi")>();
  return { ...actual, requestAnalysis, attachAnalysis, cancelAnalysis };
});

const { TurnAnalysisLauncher } = await import("../src/components/game/TurnAnalysisLauncher");

afterEach(cleanup);
beforeEach(() => {
  requestAnalysis.mockClear();
  attachAnalysis.mockClear();
  cancelAnalysis.mockClear();
});

const base = {
  roomId: "11111111-2222-3333-4444-555555555555",
  revision: 7,
  playerName: "Ann",
};

describe("a spectator", () => {
  it("is offered the analyze control only in a disabled state", () => {
    render(
      <TurnAnalysisLauncher {...base} disabled disabledReason="วิเคราะห์ได้เฉพาะตาของคุณเอง" />,
    );
    const button = screen.getByRole("button", { name: /วิเคราะห์ตานี้/ });
    expect(button).toBeDisabled();
  });

  it("cannot open the level picker, so no level can be requested", () => {
    render(<TurnAnalysisLauncher {...base} disabled disabledReason="ไม่ใช่ตาของคุณ" />);
    const button = screen.getByRole("button", { name: /วิเคราะห์ตานี้/ });
    button.click();
    // Disabled buttons do not fire, and the picker is additionally gated on
    // `!disabled` so a synthetic click cannot open it either.
    expect(screen.queryByRole("group", { name: /ระดับการวิเคราะห์/ })).not.toBeInTheDocument();
  });

  it("spends no engine request at all", () => {
    render(<TurnAnalysisLauncher {...base} disabled disabledReason="ไม่ใช่ตาของคุณ" />);
    screen.getByRole("button", { name: /วิเคราะห์ตานี้/ }).click();
    expect(requestAnalysis).not.toHaveBeenCalled();
    expect(cancelAnalysis).not.toHaveBeenCalled();
  });

  it("does not reconnect to somebody else's analysis on mount", () => {
    // A reconnect is cheap, but it is still an attempt to observe a search
    // belonging to the player whose turn it is.
    render(<TurnAnalysisLauncher {...base} disabled disabledReason="ไม่ใช่ตาของคุณ" />);
    expect(attachAnalysis).not.toHaveBeenCalled();
  });

  it("is told why, rather than shown a control that silently does nothing", () => {
    render(
      <TurnAnalysisLauncher
        {...base}
        disabled
        disabledReason="วิเคราะห์ได้เฉพาะตาของผู้เล่นที่เป็นมนุษย์"
      />,
    );
    expect(screen.getByRole("button", { name: /วิเคราะห์ตานี้/ })).toHaveAttribute(
      "title",
      "วิเคราะห์ได้เฉพาะตาของผู้เล่นที่เป็นมนุษย์",
    );
  });
});

describe("the turn the bot is playing", () => {
  it("offers no analysis to anyone, including the room owner", () => {
    // The owner controls the room but not the bot's decision. There is no human
    // decision to assist on that turn, and answering would describe a rack the
    // player cannot see.
    render(
      <TurnAnalysisLauncher
        {...base}
        disabled
        disabledReason="วิเคราะห์ได้เฉพาะตาของผู้เล่นที่เป็นมนุษย์"
      />,
    );
    expect(screen.getByRole("button", { name: /วิเคราะห์ตานี้/ })).toBeDisabled();
    expect(requestAnalysis).not.toHaveBeenCalled();
  });
});
